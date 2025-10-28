/**
 * Adapted from https://github.com/kbychkov/simplecrawler-mongo-queue
 */
const flatten = require("./flatten-obj")();
const { nanoid } = require("nanoid");

/**
 * Usage:
 * 
 * ```
 * const Crawler = require('simplecrawler');
 * const MongoQueue = Crawler.MongoQueue
 * 
 * (async () => {
 *   const crawler = new Crawler('http://example.com');
 *   crawler.queue = await MongoQueue.create(datastore, name);
 *   crawler.start();
 * })();
 * ```
 */
class MongoQueue {
    /**
     * @param {import('mongodb').Collection} collection - A MongoDB collection instance
     * @param {string} [name] - The name of the queue, optional
     */
    constructor(collection, name) {
        if (typeof collection !== "object")
            throw new Error(
                "`collection` param should be a MongoDB collection"
            );

        if (!name) {
            name = nanoid(14);
        } else if (typeof name !== "string" || name.length === 0) {
            throw new Error("`name` param should be a non-empty string");
        }

        this.collection = collection;
        this.name = name;
    }

    /**
     * @param {import('mongodb').Collection} collection - A MongoDB collection instance
     * @param {string} [name] - The name of the queue, optional
     */
    static async create(collection, name) {
        const queue = new this(collection, name);
        await queue.collection.createIndexes([
            { key: { queueName: 1, status: 1, created: 1 } },
            { key: { url: "hashed" } },
        ]);
        return queue;
    }

    mapId(queueItem) {
        if (!queueItem) return null;

        (Array.isArray(queueItem) ? queueItem : [queueItem]).forEach((item) => {
            item.id = item._id;
        });

        return queueItem;
    }

    static isAllowedStat(statisticName) {
        const allowedStats = [
            "actualDataSize",
            "contentLength",
            "downloadTime",
            "requestLatency",
            "requestTime",
        ];

        return allowedStats.includes(statisticName);
    }

    add(queueItem, force, callback) {
        const doc = Object.assign({}, queueItem, {
            queueName: this.name,
            status: "queued",
            created: new Date(),
        });

        this.exists(queueItem.url, (err, exists) => {
            if (err) {
                callback(err);
            } else if (!exists || force) {
                this.collection
                    .insertOne(doc)
                    .then((result) =>
                        this.collection
                            .findOne({ _id: result.insertedId })
                            .then((doc) => {
                                if (!doc) {
                                    callback(
                                        new Error(
                                            "Failed to retrieve inserted document"
                                        )
                                    );
                                } else {
                                    callback(null, this.mapId(doc));
                                }
                            })
                    )
                    .catch((err) => callback(err));
            } else {
                const error = new Error("Resource already exists in queue!");
                error.code = "DUPLICATE";
                callback(error);
            }
        });
    }

    exists(url, callback) {
        this.countItems({ url }, callback);
    }

    get(id, callback) {
        const query = {
            _id: id,
        };

        this.collection
            .findOne(query)
            .then((result) => callback(null, this.mapId(result)))
            .catch((err) => callback(err));
    }

    update(id, updates, callback) {
        const query = {
            _id: id,
        };
        const update = {
            $set: flatten(updates),
        };

        this.collection
            .findOneAndUpdate(query, update, { returnDocument: "after" })
            .then((doc) => {
                if (!doc) {
                    callback(new Error("No queueItem found with that ID"));
                } else {
                    callback(null, this.mapId(doc));
                }
            })
            .catch((err) => callback(err));
    }

    oldestUnfetchedItem(callback) {
        const query = {
            queueName: this.name,
            status: "queued",
        };

        this.collection
            .findOne(query, { limit: 1, sort: { created: 1 } })
            .then((doc) => callback(null, this.mapId(doc)))
            .catch((err) => callback(err));
    }

    max(statisticName, callback) {
        if (!MongoQueue.isAllowedStat(statisticName)) {
            return callback(new Error("Invalid statistic"));
        }

        const query = {
            queueName: this.name,
            fetched: true,
        };

        const key = {
            [`stateData.${statisticName}`]: -1,
        };

        this.collection
            .findOne(query, { limit: 1, sort: key })
            .then((doc) => callback(null, doc.stateData[statisticName]))
            .catch((err) => callback(err));
    }

    min(statisticName, callback) {
        if (!MongoQueue.isAllowedStat(statisticName)) {
            return callback(new Error("Invalid statistic"));
        }

        const query = {
            queueName: this.name,
            fetched: true,
        };

        const key = {
            [`stateData.${statisticName}`]: 1,
        };

        this.collection
            .findOne(query, { limit: 1, sort: key })
            .then((doc) => callback(null, doc.stateData[statisticName]))
            .catch((err) => callback(err));
    }

    avg(statisticName, callback) {
        if (!MongoQueue.isAllowedStat(statisticName)) {
            return callback(new Error("Invalid statistic"));
        }

        const query = {
            queueName: this.name,
            fetched: true,
        };

        const key = {
            _id: null,
            avg: { $avg: `$stateData.${statisticName}` },
        };

        this.collection
            .aggregate()
            .match(query)
            .group(key)
            .toArray()
            .then((result) => callback(null, result[0].avg))
            .catch((err) => callback(err));
    }

    countItems(comparator, callback) {
        const query = Object.assign({ queueName: this.name }, comparator);
        this.collection
            .countDocuments(query)
            .then((count) => callback(null, count))
            .catch((err) => callback(err));
    }

    filterItems(comparator, callback) {
        const query = Object.assign({ queueName: this.name }, comparator);

        this.collection
            .find(query)
            .toArray()
            .then((result) => callback(null, this.mapId(result)))
            .catch((err) => callback(err));
    }

    getLength(callback) {
        this.countItems({}, callback);
    }
}

module.exports = MongoQueue;
