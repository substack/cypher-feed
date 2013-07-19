var DEBUG = true;

var levelQuery = require('level-query');
var merkle = require('level-merkle');
var sublevel = require('level-sublevel');
var liveStream = require('level-live-stream');

var hyperquest = require('hyperquest');
var net = require('net');
var http = require('http');

var url = require('url');
var qs = require('querystring');

var through = require('through');
var concat = require('concat-stream');
var duplexer = require('duplexer');
var split = require('split');
var switchStream = require('switch-stream');

var shasum = require('shasum');
var subdir = require('subdir');
var inherits = require('inherits');
var EventEmitter = require('events').EventEmitter;

module.exports = Feed;

function Feed (db) {
    if (!(this instanceof Feed)) return new Feed(db);
    db = sublevel(db);
    
    this.db = db;
    this.connections = {};
    
    this.merkle = merkle(db, db.sublevel('merkle'));
    this.following = db.sublevel('following');
    this.bootstrap = db.sublevel('bootstrap');
    this.query = levelQuery(db);
}

inherits(Feed, EventEmitter);

Feed.prototype.connect = function (addr, cb) {
    var self = this;
    var stream;
    if (/^[^:]+:\d+$/.test(addr)) {
        var parts = addr.split(':');
        stream = net.connect(parseInt(parts[1]), parts[0]);
        stream.on('connect', ready);
    }
    else {
        stream = hyperquest.post(addr);
        ready();
    }
    
    self.connections[addr] = stream;
    
    stream.on('error', function (err) {
        onend();
        
        if (cb) cb(err);
        cb = function () {};
    });
    
    stream.pipe(through(function () {}, onend));
    
    function onend () {
        delete self.connections[addr];
        self.emit('disconnect', addr);
    }
    
    function ready () {
        if (cb) cb(null, stream);
        cb = function () {};
        self.emit('connect', addr);
        
        var sync = self.createStream();
        sync.pipe(stream).pipe(sync);
        
        sync.on('sync', function () {
            self.bootstrap.put(addr, {
                last: Date.now()
            });
            self.emit('sync', addr);
        });
    }
};

Feed.prototype.join = function () {
    var self = this;
    if (self._joining) return;
    self._joining = true;
    
    var rows = [];
    self.bootstrap.createReadStream().pipe(through(write, end));
    
    self.on('disconnect', function () {
        setTimeout(next, 1000);
    });
    
    function write (row) { rows.push(row) }
    
    function end () {
        var max = Math.min(rows.length, 5);
        for (var i = 0; i < max; i++) next();
    }
    
    function next () {
        var avail = rows.filter(function (row) {
            return !self.connections[row.key];
        });
        if (avail.length === 0) return;
        
        var ix = Math.floor(Math.random() * avail.length);
        var addr = avail[ix].key;
        self.connect(addr);
    }
};

Feed.prototype.publish = function (doc, cb) {
    var hash = shasum(doc);
    this.db.put(hash, doc, function (err) {
        if (!cb) return;
        if (err) cb(err)
        else cb(null, hash);
    });
    return hash;
};

Feed.prototype.follow = function (name, pubkey) {
    this.following.put(name, pubkey);
};

Feed.prototype.createStream = function () {
    var stream = this.merkle.createStream();
    stream.on('sync', function () {
        switcher.emit('sync');
        switcher.set(live);
    });
    var live = this.createLiveDuplex();
    var splitter = split(JSON.parse);
    
    var stringifier = through(function (row) {
        this.queue(JSON.stringify(row) + '\n');
    });
     
    var switcher = switchStream(stream);
    splitter.pipe(switcher).pipe(stringifier);
    
    var dup = duplexer(splitter, stringifier);
    splitter.on('error', dup.emit.bind(dup, 'error'));
    live.on('error', dup.emit.bind(dup, 'error'));
    return dup;
};

Feed.prototype.createLiveDuplex = function () {
    var live = liveStream(this.db, { old: false });
    var put = this.createPutStream();
    var dup = duplexer(put, live);
    put.on('error', dup.emit.bind(dup, 'error'));
    live.on('error', dup.emit.bind(dup, 'error'));
    return dup;
};

Feed.prototype.createPutStream = function () {
    var self = this;
    var db = self.db;
    
    return through(function (row) {
        if (!row || typeof row !== 'object') return;
        // sha sum didn't match, reject and close the connection
        if (row.key !== shasum(row.value)) {
            sp.emit('error', 'shasum mismatch for key ' + row.key);
        }
        
        db.get(row.key, function (err, value) {
            if (!value) db.put(row.key, row.value);
        });
    });
};

Feed.prototype.createLocalServer = function () {
    return http.createServer(this.handleLocal.bind(this));
};

Feed.prototype.createServer = function () {
    return http.createServer(this.handlePublic.bind(this));
};

Feed.prototype.handleLocal = function (req, res) {
    var self = this;
    var u = url.parse(req.url);
    var params = qs.parse(u.search.replace(/^\?/, ''));
    
    if (req.method === 'PUT' && u.pathname === '/publish') {
        req.pipe(concat(function (body) {
            if (params.encoding === 'json') {
                try { var doc = JSON.parse(body) }
                catch (err) {
                    res.statusCode = 400;
                    res.end(err + '\n');
                    return;
                }
            }
            else if (params.raw) {
                doc = body.toString('utf8');
            }
            else {
                var enc = params.encoding || 'utf8';
                doc = { body: body.toString(enc) };
                if (params.type) doc.type = params.type;
                if (params.encoding) doc.encoding = params.encoding;
                if (params.filename) doc.filename = params.filename;
            }
            self.publish(doc, function (err, hash) {
                if (err) {
                    res.statusCode = 500;
                    res.end(err + '\n');
                }
                else res.end(hash + '\n');
            });
        }));
    }
    else if (req.method === 'GET' && u.pathname === '/query') {
        res.setHeader('content-type', 'application/json');
        res.setTimeout(0);
        var q = self.query(req.url);
        q.on('error', function (err) { res.end(err + '\n') });
        q.pipe(res);
    }
    else if (req.method === 'GET' && u.pathname === '/connect') {
        if (!params.addr) {
            res.statusCode = 400;
            res.end('required parameter "addr" missing\n');
            return;
        }
        self.connect(params.addr, function (err) {
            if (err) {
                res.statusCode = 404; // todo: resource unvailable code
                res.end(err + '\n');
            }
            else res.end('ok\n');
        });
    }
    else {
        res.statusCode = 404;
        res.end('not found\n');
    }
};

Feed.prototype.handlePublic = function (req, res) {
    var self = this;
    if (DEBUG) console.log(req.method, req.url);
    if (req.method === 'POST' && req.url === '/') {
        req.pipe(self.createStream()).pipe(res);
    }
    else {
        res.statusCode = 404;
        res.end('not found\n');
    }
};
