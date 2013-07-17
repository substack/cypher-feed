var levelQuery = require('level-query');
var merkle = require('level-merkle');
var sublevel = require('level-sublevel');

var hyperquest = require('hyperquest');
var net = require('net');

var through = require('through');

var shasum = require('shasum');
var subdir = require('subdir');
var inherits = require('inherits');

var noCache = require('./lib/no_cache.js');

module.exports = Feed;

function Feed (db) {
    if (!(this instanceof Feed)) return new Feed(db);
    db = this.db = sublevel(db);
    
    this.merkle = merkle(db, db.sublevel('merkle'));
    this.following = db.sublevel('following');
    this.bootstrap = db.sublevel('bootstrap');
    this.connections = {};
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
        stream.on('response', function () {
            if (cb) cb(null, stream);
            cb = function () {};
        });
    }
    
    self.connections[addr] = stream;
    
    stream.on('error', function (err) {
        onend();
        
        if (cb) cb(err);
        cb = function () {};
    });
    
    stream.pipe(through(function () {}, onend);
    
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

Feed.prototype.publish = function (doc) {
    var hash = shasum(doc);
    db.put(hash, doc);
};

Feed.prototype.follow = function (name, pubkey) {
    this.following.put(name, pubkey);
};

Feed.prototype.createStream = function () {
    var stream = this.merkle.createStream()
        .pipe(through(null, function () {
            switcher.change(1);
        }))
    ;
    var putStream = this.createPutStream();
    var switcher = switchStream([ stream, putStream ]);
    return switcher;
};

Feed.prototype.createPutStream = function () {
    var stream = through();
    return stream;
};

function switchStream (streams) {
    var stream = through(write, end);
    var index = 0;
    
    streams.forEach(function (s, ix) {
        s.pipe(through(write, end));
        
        function write (buf) {
            if (index === ix) stream.queue(buf);
        }
        
        function end () {
            if (index === ix) stream.queue(null);
        }
    });
    
    stream.change = function (ix) {
        index = ix;
    };
    return stream;
    
    function write (buf) {
        streams[index].write(buf);
    }
    
    function end () {
        streams[index].end(buf);
    }
}
