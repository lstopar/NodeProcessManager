var messages = require('./messages.js');

const REQUEST_TIMEOUT = 10000;

exports.ProcessManager = class ProcessManager {
    
    constructor(opts) {
        if (opts.processes == null)
            throw new Error('Processes not defined!');

        this._initProcesses(opts.processes);
    }
   
    /*
     * Sends a message to one or all processes.
     *
     * @param {Object} msg - the message to send
     * @param {Integer} [processId] - the ID of the process, if missing the message will be sent to all the processes
     */
    sendMsg(msg, procN) {
        if (procN != null) {
            if (procN < 0 || procN >= this.processes.length)
                throw new Error('Invalid process number: ' + procN);
            
            console.log('Sending message to slave ' + procN + ' ...');
            this.processes[procN].send(msg);            
        }
        else {
            console.log('Sending message to all slaves ...');
            for (var i = 0; i < this.processes.length; i++) {
                this.sendMsg(msg, i);
            }
        }
    }

    sendRequest(content, procN, cb) {
        if (procN == null)
            return cb(new Error('Process identifier missing when sending request!'));
        if (procN < 0 || procN >= this.processes.length)
            return cb(new Error('Invalid process identifier: ' + procN));

        var self = this;

        try {
            var reqN = this.seqV[procN];

            var req = messages.genRequest(content, reqN);
            var handler = function (e, res) {
                if (e != null)
                    return cb(e);

                console.log('Received response from process: ' + procN);

                self.off('response', procN, handler, reqN);
                cb(undefined, res);
            }

            this.on('response', procN, handler, reqN);
            this.sendMsg(req, procN);
        } catch (e) {
            cb(e);
        }
    }

    on(event, procId, handler, reqN) {  // TODO in the future keep requests internal
        if (handler == null)
            throw new Error('Handler is null!');
        if (event != 'response' && event != 'message')
            throw new Error('Invalid event name: ' + event);

        if (event == 'message') {
            this.procHandlerV[procId][event].push(handler);
        }
        else {
            this.procHandlerV[procId][event].push({
                reqN: reqN,
                handler: handler,
                timestamp: new Date().getTime() // TODO clean timedout requests
            });
        }
    }

    off(event, procId, handler, reqN) {
        if (handler == null)
            throw new Error('Handler is null!');
        if (event != 'response' && event != 'message')
            throw new Error('Invalid event name: ' + event);

        console.log('Removing handler ...');

        var handlers = this.procHandlerV[procId][event];

        if (event == 'message') {
            var handlerN = handlers.indexOf(handler);

            if (handlerN < 0)
                throw new Error('Cannot remove non-registered handler!');

            handlers.splice(handlerN, 1);
        }
        else {
            // TODO optimize
            for (var handlerN = 0; handlerN < handlers.length; handlerN++) {
                var handlerConf = handlers[handlerN];
                if (handlerConf.reqN == reqN) {
                    handlers.splice(handlerN, 1);
                    return;
                }
            }
        }
    }

    _initProcesses(processes) {
        this.processes = [];
        this.seqV = [];
        this.procHandlerV = [];

        var self = this;
        for (var i = 0; i < processes.length; i++) {
            (function () {
                var child = processes[i];
                var childId = child.pid;
                var childN = i;

                /*
                child.stdout.on('data', (data) => {
                    console.log('Received chink from process ${processId}: ${data}');
                    // TODO
                });

                child.stderr.on('data', (data) => {
                    console.error(data, 'Exception in slave: ${processId}');
                    // TODO
                });
                */
                child.on('error', (e) => {
                    console.error(e, 'Failed to start process:' + childId);
                    // TODO
                });

                child.on('close', (code) => {
                    console.log('Slave ' + childId + ' exited with code:' + code);
                    // TODO
                });

                child.on('message', (msg) => {
                    try {
                        console.log('Received message from child ' + childId + ': ' + JSON.stringify(msg) + '...');

                        var type = msg.type;

                        switch(type) {
                            case 'message': {
                                var handlers = self.procHandlerV[childN].message;
                                for (var handlerN = 0; handlerN < handlers.length; handlerN++) {
                                    var handler = handlers[handlerN];
                                    handler(msg);
                                }
                                break;
                            }
                            case 'response': {
                                var handlers = self.procHandlerV[childN].response;
                                
                                var delHandlerN = null;
                                for (var handlerN = 0; handlerN < handlers.length; handlerN++) {
                                    var config = handlers[handlerN];

                                    var reqN = msg.reqN;
                                    var status = msg.status;

                                    if (config.reqN != msg.reqN) continue;

                                    if (status == 'error')
                                        config.handler(new Error(msg.content));
                                    else
                                        config.handler(undefined, msg.content);

                                    delHandlerN = handlerN;
                                    break;
                                }

                                if (delHandlerN != null) {
                                    console.log('Response received, removing handler ...');
                                    handlers.splice(delHandlerN, 1);
                                }

                                break;
                            }
                            default: {
                                throw new Error('Unknown message type: ' + type);
                            }
                        }

                        self._cleanupRespHandlers();
                    } catch (e) {
                        console.log(e, 'Exception while processing child message!');
                    }
                });
            })();

            this.processes.push(processes[i]);
            this.seqV.push(0);
            this.procHandlerV.push({
                message: [],
                response: []
            });
        }
    }

    _cleanupRespHandlers() {
        var timestamp = new Date().getTime();
        
        console.log('Cleaning up handlers ...');

        for (var procN = 0; procN < this.procHandlerV.length; procN++) {
            var handlers = this.procHandlerV[procN].response;

            for (var handlerN = handlers.length-1; handlerN >= 0; handlerN--) {
                var reqTimestamp = handlers[handlerN].timestamp;

                if (timestamp - reqTimestamp > REQUEST_TIMEOUT) {
                    handlers[handlerN].handler(new Error('Request timedout!'));

                    console.log('Removing handler ' + handlerN + ' of process ' + procN);
                    handlers.splice(handlerN, 1);
                }
            }
        }
    }
}

exports.ChildProcess = class ChildProcess {
    constructor() {
        this.handlers = {
            request: function (msg, cb) { cb(undefined, null); },   // XXX: when no handler is present send an empty response
            message: function (msg) {}
        };

        var self = this;
        process.on('message', (msg) => {
            self._onMessage(msg);
        });
    }

    on(event, handler) {
        if (event != 'request' && event != 'message')
            throw new Error('Unknown event: ' + event);
        this.handlers[event] = handler;
    }

    _onMessage(msg) {
        try {
            console.log('Received message in child: ' + JSON.stringify(msg) + ' ...');

            var type = msg.type;
            switch (type) {
                case 'ping': {
                    var pong = messages.genPong();
                    process.send(pong);
                    break;
                }
                case 'request': {
                    var handler = this.handlers.request;

                    try {
                        handler(msg.content, (e, res) => {
                            if (e != null) {
                                console.error(e, 'Exception in child process!');
                                process.send(messages.genErrorResponse(msg, e.message));
                                return;
                            }

                            var responseMsg = messages.genResponse(msg, res);
                            process.send(responseMsg);
                        });
                    } catch (e) {
                        console.error(e, 'Exception while processing request!');
                        process.send(messages.genErrorResponse(msg, e.message));
                    }
                    break;
                }
                case 'message': {
                    var handler = this.handlers.message;
                    handler(msg.content);
                    break;
                }
                default: {
                    // XXX: if not supported throw an exception for now.
                    throw new Error('Invalid message type: ' + type);
                }
            }

        } catch (e) {
            console.log(e, 'Exception while processing message from parent!');
        }

    }

}
