var path = require('path');
var os = require('os');
var fs = require('fs');

process.stdout.on('error', function () {});

var argv = require('minimist')(process.argv.slice(2));
if (argv.h || argv.help || argv._[0] === 'help') return help();

var home = process.env.HOME || process.env.USERPROFILE;
var dbfile = argv.db || path.join(home, '.config', 'cypher-feed', 'data');
var sockfile = argv.sock || path.join(home, '.config', 'cypher-feed', 'sock');

var mkdirp = require('mkdirp');
mkdirp.sync(dbfile);

var hyperquest = require('hyperquest');
var defined = require('defined');

var levelup = require('levelup');
var sublevel = require('level-sublevel');
var db = sublevel(levelup(dbfile, { encoding: 'json' }));
var feed = require('../')(db);

var cmd = argv._[0];

if (cmd === 'start') {
    var server = feed.createLocalServer();
    if (/^win/i.test(os.platform())) {
        server.listen(41963, '127.0.0.1');
        console.log('listening on 127.0.0.1:41963');
    }
    else {
        server.listen(sockfile);
        console.log('listening on ' + sockfile);
    }
}
else if (cmd === 'publish') {
    var file = argv._[0];
    if (!file) {
        console.error('usage: cypher-feed publish FILE');
        return process.exit(1);
    }
    
    var encoding = argv.encoding || argv.e;
    if (argv.json) encoding = 'json';
    if (!encoding && /\.json/.test(file)) encoding = 'json';
    if (!encoding) encoding = 'utf8';
    
    var type = argv.type || argv.t || 'file';
    
    var hq = hyperquest(serverOpts({
        method: 'PUT',
        path: '/publish?' + qs.stringify({
            encoding: encoding,
            raw: Boolean(argv.raw || argv.r),
            type: type,
            filename: argv.filename || argv.f
        })
    })).pipe(process.stdout);;
    
    fs.createReadStream(argv._[1]).pipe(hq);
}
else if (cmd === 'list' || cmd === 'query') {
    var hq = hyperquest(serverOpts({
        method: 'GET',
        path: '/query' + qs.stringify(argv)
    })).pipe(process.stdout);;
}
else help()

function help () {
    fs.createReadStream(__dirname + '/usage.txt').pipe(process.stdout);
}

function serverOpts (opts) {
    if (!opts) opts = {};
    if (/^win/i.test(os.platform())) {
        opts.host = '127.0.0.1';
        opts.port = 41963;
    }
    else {
        opts.socketPath = sockfie;
    }
    return opts
}
