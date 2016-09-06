var processmanager = require('./processmanager.js');

try {
    var nRequests = 0;
    var nMessages = 0;

//    setInterval(() => {
//        updates++;
//    }, (1000 + Math.random()*10000).toFixed());


    var proc = new processmanager.ChildProcess();
    
    proc.on('request', (req, cb) => {
        cb(undefined, { requests: ++nRequests });
    });

    proc.on('message', (msg) => {
        // TODO do nothing for now
    });
} catch (e) {
    console.error(e, 'Exception in child process!');
    process.exit(2);
}
