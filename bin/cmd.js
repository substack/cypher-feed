var path = require('path');
var os = require('os');
var fs = require('fs');
var qs = require('querystring');

process.stdout.on('error', function () {});

var argv = require('minimist')(process.argv.slice(2));
if (argv.h || argv.help || argv._[0] === 'help') return help();

var port = argv.port || argv.p || 41963;
var home = process.env.HOME || process.env.USERPROFILE;
var dbfile = argv.db || path.join(home, '.config', 'cypher-feed', 'data');

var mkdirp = require('mkdirp');
mkdirp.sync(dbfile);

var hyperquest = require('hyperquest');
var defined = require('defined');

var cmd = argv._[0];

if (cmd === 'start' || cmd === 'server') {
    var levelup = require('levelup');
    var sublevel = require('level-sublevel');
    var db = sublevel(levelup(dbfile, { encoding: 'json' }));
    var feed = require('../')(db);
    //feed.join();
    
    if (cmd === 'start') {
        var server = feed.createLocalServer();
        server.listen(port, '127.0.0.1');
        console.log('local server listening on 127.0.0.1:' + port);
    }
    else {
        var server = feed.createServer();
        server.listen(port);
        console.log('public server listening on 0.0.0.0:' + port);
    }
}
else if (cmd === 'publish') {
    var file = argv._[1];
    if (!file) {
        console.error('usage: cypher-feed publish FILE');
        return process.exit(1);
    }
    
    var encoding = argv.encoding || argv.e;
    if (argv.json) encoding = 'json';
    if (!encoding && /\.json/.test(file)) encoding = 'json';
    if (!encoding) encoding = 'utf8';
    
    var type = argv.type || argv.t || 'file';
    
    var u = 'http://localhost:' + port + '/publish?';
    var hq = hyperquest.put(u + qs.stringify({
        encoding: encoding,
        raw: Boolean(argv.raw || argv.r),
        type: type,
        filename: defined(argv.filename, argv.f, path.basename(file))
    }));
    hq.pipe(process.stdout);
    
    fs.createReadStream(file).pipe(hq);
}
else if (cmd === 'list' || cmd === 'query') {
    var u = 'http://localhost:' + port + '/query?';
    hyperquest(u + qs.stringify(argv)).pipe(process.stdout);
}
else if (cmd === 'connect') {
    var u = 'http://localhost:' + port + '/connect?';
    var addr = argv._[1];
    var hq = hyperquest(u + qs.stringify({ addr: addr }));
    hq.pipe(process.stdout);
}
else help()

function help () {
    fs.createReadStream(__dirname + '/usage.txt').pipe(process.stdout);
}
