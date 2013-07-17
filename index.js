var levelQuery = require('level-query');
var subdir = require('subdir');
var noCache = require('./lib/no_cache.js');
var url = require('url');
var qs = require('querystring');

module.exports = function (db, opts) {
    if (!opts) opts = {};
    var prefix = opts.prefix || '/feed';
    if (!/^\//.test(prefix)) prefix = '/' + prefix;
    
    var query = levelQuery(db);
    var feed = function (req, res) {
        if (req.method === 'GET') {
            res.setHeader('content-type', 'application/json');
            noCache(res);
            var q = query(req.url);
            q.on('error', function (err) { res.end(err + '\n') });
            q.pipe(res);
        }
        else if (req.method === 'POST') {
            res.setHeader('content-type', 'application/json');
            noCache(res);
            req.pipe(feed.createStream()).pipe(res);
        }
        else {
            res.statuSCode = 404;
            res.end('not found\n');
        }
    };
    
    feed.test = function (u) {
        var p = u.split('?')[0];
        return p === prefix
            || p === prefix + '.json'
            || subdir(prefix, p)
        ;
    };
    
    feed.createReadStream = function (params) {
        return query(params);
    };
    
    feed.createStream = function () {
        
    };
    
    return feed;
};
