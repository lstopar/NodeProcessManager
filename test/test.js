var express = require('express');
var fs = require('fs');
var fork = require('child_process').fork;

var processmanager = require('../');

//=========================================
// VARIABLES
//=========================================

var config = (function () {
    if (process.argv.length < 3) {
        console.log('Usage: node test.js $CONFIG_FILE');
        process.exit(1);
    }

    var confFile = process.argv[2];
    var configStr = fs.readFileSync(confFile);
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
            
            pm.request({}, slaveN, (e, childRes) => {
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

            pm.send({}, slaveN);
            res.send({ success: true });
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
    var slaveIds = ['a', 'b', 'c', 'd'];
    var slaves = [];
    for (var i = 0; i < slaveIds.length; i++) {
        console.log('Starting process \'' + slaveIds[i] + '\' ...');
        var slave = fork(__dirname + '/slave.js', []);
        slaves.push(slave);
    } 

    pm = new processmanager.master();
    server = initServer();

    pm.register(slaves, slaveIds);

    pm.on('close', (slaveId) => {
        console.log('Child \'' + slaveId + '\' exited!');
    });

    pm.on('error', (slaveId, e) => {
        console.error(e, 'Error with slave: ' + slaveId);
    })

    pm.on('message', (slaveId, msg) => {
        console.log('Received a message from slave ' + slaveId + ': ' + JSON.stringify(msg));
    });

    console.log('Initialized!');
} catch (e) {
    console.error(e, 'Exception while initializing!');
    process.exit(2);
}
