var express = require('express');
var fs = require('fs');
var fork = require('child_process').fork;

var processmanager = require('./src/processmanager.js');

//=========================================
// VARIABLES
//=========================================

var config = (function () {
    if (process.argv.length < 2) {
        console.log('Usage: node main.js $CONFIG_FILE');
        process.exit(1);
    }

    var confFile = process.argv[1];
    var configStr = fs.readFileSync('config.json');
    return JSON.parse(configStr);
})();

var pm = null;
var server = null;

//=========================================
// HELPER FUNCTIONS
//=========================================

function handleBadInput(res, msg) {
    res.status(400);    // bad request
    res.send(msg);
    res.end();
}

function handleServerError(e, req, res) {
    console.error(e, 'Exception while processing request!');
    res.status(500);    // internal server error
    res.send(e.message);
    res.end();
}

function initServer() {
    if (config.server == null || config.server.port == null) throw new Error('Server configuration missing!');

    var app = express();
    
    app.get('/slaves/request', function (req, res) {
        try {
            var slaveN = req.query.n;

            if (slaveN == null)
                return handleBadInput(res, 'Need process number!');
            
            pm.sendRequest({}, slaveN, (e, childRes) => {
                if (e != null)
                    return handleServerError(e, req, res);
                
                console.log('Sending response: ' + JSON.stringify(childRes));

                res.send(childRes);
                res.end();
            });
        } catch (e) {
            console.error(e, 'Exception while processing touch request!');
        }
    });

    app.get('/slaves/message', function (req, res) {
        try {
            var slaveN = req.query.n;

            pm.sendMsg({}, slaveN);
            res.status(204) ;
            res.end();
        } catch (e) {
            console.error(e, 'Exception while processing touch request!');
        }
    });

    var server = app.listen(config.server.port);

    console.log('====================================');
    console.log('Server started on port: ' + config.server.port);
    console.log('====================================');

    return server;
}

//=========================================
// INITIALIZE
//=========================================

try {
    console.log('Initializing ...');

    // initialize the processes
    var processes = [];
    for (var i = 0; i < config.processes; i++) {
        console.log('Starting process ' + i + ' ...');
        var slave = fork('src/slave.js', ['dummy']);
        processes.push(slave);
    }    

    pm = new processmanager.ProcessManager({ processes: processes });
    server = initServer();

    pm.on('message', (childId, msg) => {
        console.log('Received a message from slave ' + childId + ': ' + JSON.stringify(msg));
    });

    console.log('Initialized!');
} catch (e) {
    console.error(e, 'Exception while initializing!');
    process.exit(2);
}

