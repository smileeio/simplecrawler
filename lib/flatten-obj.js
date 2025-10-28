const isObj = require("isobj");

module.exports = function (options) {
    options = options || {};
    let blacklist = options.blacklist || [];
    // eslint-disable-next-line no-eq-null, eqeqeq
    let separator = options.separator == null ? "." : options.separator;
    let onlyLeaves = options.onlyLeaves && true;

    return flatten;

    function flatten(obj) {
        let result = {};
        iterator(obj, "", result);
        return result;
    }

    function iterator(obj, prefix, flattened) {
        let keys = Object.keys(obj);

        for (let n = 0; n < keys.length; n++) {
            let key = keys[n];
            let val = obj[key];

            if (isObj(val) && !isBlacklisted(val)) {
                iterator(val, prefix + key + separator, flattened);
                continue;
            }

            if (onlyLeaves) {
                flattened[key] = val;
            } else {
                flattened[prefix + key] = val;
            }
        }
    }

    function isBlacklisted(obj) {
        for (let i = 0; i < blacklist.length; i++) {
            if (obj instanceof blacklist[i]) {
                return true;
            }
        }
    }
};
