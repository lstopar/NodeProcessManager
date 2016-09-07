var processmanager = require('./processmanager.js');

try {
    var nRequests = 0;
    var nMessages = 0;

    function genMsg() {
        return { requests: nRequests, messages: nMessages };
    }

    var proc = new processmanager.ChildProcess();
    
    proc.on('request', (req, cb) => {
        nRequests++;
        cb(undefined, genMsg());
    });

    proc.on('message', (msg) => {
        console.log('Received message in slave ...');
        nMessages++;
        proc.sendMsg(genMsg());
    });
} catch (e) {
    console.error(e, 'Exception in child process!');
    process.exit(2);
}
