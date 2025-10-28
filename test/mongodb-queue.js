const MongoClient = require("mongodb").MongoClient;
const assert = require("assert");
const { nanoid } = require("nanoid");

describe("MongoDB Queue object", function () {
    const MongoQueue = require("../lib/mongo-queue");
    const exampleJSON = require("./fixtures/mongodb-queue.json");

    const dbUri = "mongodb://localhost:27017";
    const dbName = "simplecrawler-mongo-queue-test";

    before(function (done) {
        let self = this;
        this.timeout(5000);
        MongoClient.connect(dbUri)
            .then((client) => {
                self.dbClient = client;
                done();
            })
            .catch((err) => done(err));
    });

    after(function (done) {
        let self = this;
        self.dbClient
            .db(dbName)
            .dropDatabase()
            .then(() => self.dbClient.close().then(() => done()))
            .catch((err) => done(err));
    });

    beforeEach(function () {
        this.dbCollection = this.dbClient.db(dbName).collection(nanoid());
    });

    it("exports function", function () {
        assert.equal(typeof MongoQueue, "function");
    });

    it("throws an error when incorrect `collection` passed", function () {
        try {
            new MongoQueue();
        } catch (e) {
            assert.equal(
                e.message,
                "`collection` param should be a MongoDB collection"
            );
        }
    });

    it("throw an error when incorrect `name` passed", function () {
        try {
            new MongoQueue(this.dbCollection, "");
        } catch (e) {
            assert.equal(
                e.message,
                "`name` param should be a non-empty string"
            );
        }
    });

    it("initialized without a name", function () {
        const queue = new MongoQueue(this.dbCollection);

        assert.ok(queue instanceof MongoQueue);
        assert.ok(typeof queue.name === "string");
        assert.ok(queue.name.length > 0);
    });

    it("initialized with a given name", function () {
        const queue = new MongoQueue(this.dbCollection, "example");

        assert.ok(queue instanceof MongoQueue);
        assert.equal(queue.name, "example");
    });

    it("should create DB indexes and return MongoQueue instance", async function () {
        const queue = await MongoQueue.create(this.dbCollection);
        const result = await this.dbCollection.indexes();

        assert.ok(queue instanceof MongoQueue);
        assert.equal(result.length, 3);
    });

    it("should be able to reuse `create` method", async function () {
        class ChildQueue extends MongoQueue {
            static async create(collection) {
                return MongoQueue.create.call(this, collection);
            }
        }

        const child = await ChildQueue.create(this.dbCollection);

        assert.ok(child instanceof MongoQueue);
        assert.ok(child instanceof ChildQueue);
    });

    it("should project `_id` attribute to `id` for an item", function () {
        const queue = new MongoQueue(this.dbCollection);

        const result = queue.mapId(Object.assign({}, exampleJSON[0]));

        assert.equal(result.id, 1);
    });

    it("should project `_id` attribute to `id` for all items in array", function () {
        const queue = new MongoQueue(this.dbCollection);

        const result = queue.mapId(Array.from(exampleJSON));

        result.forEach((item, i) => {
            assert.equal(item.id, exampleJSON[i]._id);
        });
    });

    it("should find example record", function (done) {
        const queue = new MongoQueue(this.dbCollection, "example");

        this.dbCollection
            .insertMany(exampleJSON)
            .then((_result) => {
                queue.exists("http://example.com/", (err, result) => {
                    assert.equal(err, null);
                    assert.equal(result, 1);
                    done();
                });
            })
            .catch((err) => done(err));
    });

    it("should add to the queue", function (done) {
        const queue = new MongoQueue(this.dbCollection, "example");
        const queueItem = {
            host: "example.com",
            path: "/",
            port: "",
            protocol: "http",
            uriPath: "/",
            url: "http://example.com/",
            depth: 1,
            referrer: "http://example.com",
            fetched: false,
            status: "created",
            stateData: {},
        };

        queue.add(queueItem, false, (err, result) => {
            assert.equal(err, null);
            assert.ok(result.id);
            assert.ok(result.created instanceof Date);
            assert.equal(result.status, "queued");
            done();
        });
    });

    it("should return error when add duplicate", function (done) {
        const queue = new MongoQueue(this.dbCollection, "example");
        const queueItem = {
            host: "example.com",
            path: "/",
            port: "",
            protocol: "http",
            uriPath: "/",
            url: "http://example.com/",
            depth: 1,
            referrer: "http://example.com",
            fetched: false,
            status: "created",
            stateData: {},
        };

        this.dbCollection
            .insertMany(exampleJSON)
            .then((_result) => {
                queue.add(queueItem, false, (err, _result) => {
                    if (err) {
                        done();
                    } else {
                        assert.ok(false);
                    }
                });
            })
            .catch((err) => done(err));
    });

    it("should return the queue item by id", function (done) {
        const queue = new MongoQueue(this.dbCollection, "example");

        this.dbCollection
            .insertMany(exampleJSON)
            .then((_result) => {
                queue.get(1, (err, result) => {
                    assert.equal(err, null);
                    assert.equal(result.url, "http://example.com/");
                    done();
                });
            })
            .catch((err) => done(err));
    });

    it("should update queue item", function (done) {
        const queue = new MongoQueue(this.dbCollection, "example");
        const updates = {
            stateData: {
                sentIncorrectSize: false,
            },
        };

        this.dbCollection
            .insertMany(exampleJSON)
            .then((_result) => {
                queue.update(1, updates, (err, result) => {
                    assert.equal(err, null);
                    assert.equal(result.url, "http://example.com/");
                    assert.equal(result.stateData.sentIncorrectSize, false);
                    assert.equal(
                        result.stateData.headers["content-encoding"],
                        "gzip"
                    );
                    done();
                });
            })
            .catch((err) => done(err));
    });

    it("should return error when updating nonexistent item", function (done) {
        const queue = new MongoQueue(this.dbCollection, "example");
        const updates = {
            fetched: true,
            status: "downloaded",
        };

        queue.update(0, updates, (err, _result) => {
            if (err) {
                assert.equal(err.message, "No queueItem found with that ID");
                done();
            } else {
                assert.ok(false);
            }
        });
    });

    it("should return oldest unfetched item", function (done) {
        const queue = new MongoQueue(this.dbCollection, "example");

        this.dbCollection
            .insertMany(exampleJSON)
            .then((_result) => {
                queue.oldestUnfetchedItem((err, result) => {
                    assert.equal(err, null);
                    assert.equal(result.id, 3);
                    assert.equal(result.url, "http://example.com/foo");
                    done();
                });
            })
            .catch((err) => done(err));
    });

    it("should return the number of fetched items", function (done) {
        const queue = new MongoQueue(this.dbCollection, "example");

        this.dbCollection
            .insertMany(exampleJSON)
            .then((_result) => {
                queue.countItems({ fetched: true }, (err, result) => {
                    assert.equal(err, null);
                    assert.equal(result, 2);
                    done();
                });
            })
            .catch((err) => done(err));
    });

    it("should return the number of queued items", function (done) {
        const queue = new MongoQueue(this.dbCollection, "example");

        this.dbCollection
            .insertMany(exampleJSON)
            .then((_result) => {
                queue.countItems({ status: "queued" }, (err, result) => {
                    if (err) return done(err);
                    assert.equal(result, 2);
                    done();
                });
            })
            .catch((err) => done(err));
    });

    it("should return the length of the queue", function (done) {
        const queue = new MongoQueue(this.dbCollection, "example");

        this.dbCollection
            .insertMany(exampleJSON)
            .then((_result) => {
                queue.getLength((err, result) => {
                    assert.equal(err, null);
                    assert.equal(result, 4);
                    done();
                });
            })
            .catch((err) => done(err));
    });

    it("should return all queue items with the status code 200", function (done) {
        const queue = new MongoQueue(this.dbCollection, "example");

        this.dbCollection
            .insertMany(exampleJSON)
            .then((_result) => {
                queue.filterItems({ "stateData.code": 200 }, (err, result) => {
                    assert.equal(err, null);
                    assert.equal(result.length, 2);
                    assert.equal(result[0].id, 1);
                    assert.equal(result[1].id, 2);
                    done();
                });
            })
            .catch((err) => done(err));
    });

    it("should verify against allowed statistics", function () {
        assert.ok(MongoQueue.isAllowedStat("actualDataSize"));
        assert.ok(MongoQueue.isAllowedStat("contentLength"));
        assert.ok(MongoQueue.isAllowedStat("downloadTime"));
        assert.ok(MongoQueue.isAllowedStat("requestLatency"));
        assert.ok(MongoQueue.isAllowedStat("requestTime"));
        assert.equal(MongoQueue.isAllowedStat("isNotAllowed"), false);
    });

    it("should get a max statistic from the queue", function (done) {
        const queue = new MongoQueue(this.dbCollection, "example");

        this.dbCollection
            .insertMany(exampleJSON)
            .then((_result) => {
                queue.max("contentLength", (err, result) => {
                    assert.equal(err, null);
                    assert.equal(result, 1234);
                    done();
                });
            })
            .catch((err) => done(err));
    });

    it("should get a min statistic from the queue", function (done) {
        const queue = new MongoQueue(this.dbCollection, "example");

        this.dbCollection
            .insertMany(exampleJSON)
            .then((_result) => {
                queue.min("requestTime", (err, result) => {
                    assert.equal(err, null);
                    assert.equal(result, 341);
                    done();
                });
            })
            .catch((err) => done(err));
    });

    it("should get an avg statistic from the queue", function (done) {
        const queue = new MongoQueue(this.dbCollection, "example");

        this.dbCollection
            .insertMany(exampleJSON)
            .then((_result) => {
                queue.avg("contentLength", (err, result) => {
                    assert.equal(err, null);
                    assert.equal(result, 920);
                    done();
                });
            })
            .catch((err) => done(err));
    });
});
