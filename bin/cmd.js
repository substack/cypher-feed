var path = require('path');
var os = require('os');
var fs = require('fs');
var qs = require('querystring');

process.stdout.on('error', function () {});

var argv = require('minimist')(process.argv.slice(2));
if (argv.h || argv.help || argv._[0] === 'help') return help();

var home = process.env.HOME || process.env.USERPROFILE;
var dbfile = argv.db || path.join(home, '.config', 'cypher-feed', 'data');

var mkdirp = require('mkdirp');
mkdirp.sync(dbfile);

var hyperquest = require('hyperquest');
var defined = require('defined');

var cmd = argv._[0];

if (cmd === 'start') {
    var levelup = require('levelup');
    var sublevel = require('level-sublevel');
    var db = sublevel(levelup(dbfile, { encoding: 'json' }));
    var feed = require('../')(db);
    
    var server = feed.createLocalServer();
    server.listen(41963, '127.0.0.1');
    console.log('listening on 127.0.0.1:41963');
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
    
    var hq = hyperquest.put('http://localhost:41963/publish?' + qs.stringify({
        encoding: encoding,
        raw: Boolean(argv.raw || argv.r),
        type: type,
        filename: defined(argv.filename, argv.f, path.basename(file))
    }));
    hq.pipe(process.stdout);
    
    fs.createReadStream(file).pipe(hq);
}
else if (cmd === 'list' || cmd === 'query') {
    var hq = hyperquest('http://localhost:41963/query?' + qs.stringify(argv));
    hq.pipe(process.stdout);
}
else help()

function help () {
    fs.createReadStream(__dirname + '/usage.txt').pipe(process.stdout);
}
