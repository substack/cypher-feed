var levelup = require('levelup');
var sublevel = require('level-sublevel');
var db = sublevel(levelup(__dirname + '/a'));
var query = require('level-query')(db);
var feed = require('../')(db, { prefix: '/feed' });

var http = require('http');
var server = http.createServer(function (req, res) {
    if (feed.test(req.url)) return feed(req, res);
    
    var host = req.headers.host;
    res.write('npm install -g cypher-feed\n');
    res.end('cypher-feed http://' + host + '/feed.json\n');
});
server.listen(4001);
