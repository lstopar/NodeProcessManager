var messages = require('./messages.js');

const REQUEST_TIMEOUT = 10000;


class SlaveProcess {
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

    /**
     * Sends a message to the master.
     *
     * @param {Object} msg - the message
     */
    sendMsg(msg) {
       this._sendMsg(messages.genMessage(msg));
    }

    /**
     * Registers a new event handler.
     *
     * @param {String} event - name of the event, either 'message' or 'request'
     * @param {Function} handler - the event handler. When registering a message handler the function takes one argument: the message,
     * while when registering a request handler the function takes two arguments: the request and the callback
     */
    on(event, handler) {
        if (event != 'request' && event != 'message')
            throw new Error('Unknown event: ' + event);
        this.handlers[event] = handler;
    }

    _sendMsg(msg) {
        console.log('Sending message: ' + JSON.stringify(msg));
        process.send(msg);
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
                        var self = this;
                        handler(msg.content, (e, res) => {
                            if (e != null) {
                                console.error(e, 'Exception in child process!');
                                self._sendMsg(messages.genErrorResponse(msg, e.message));
                                return;
                            }

                            self._sendMsg(messages.genResponse(msg, res));
                        });
                    } catch (e) {
                        console.error(e, 'Exception while processing request!');
                        self._sendMsg(messages.genErrorResponse(msg, e.message));
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

class MasterProcess {
    
    constructor(opts) {
        if (opts.processes == null)
            throw new Error('Processes not defined!');

        this._initProcesses(opts.processes);
    }

    /**
     * Sends an asynchrounous message to one or all of the slaves.
     *
     * @param {Object} content - content of the message
     * @param {Integer} [procN] - the index of the slave
     */
    sendMsg(content, procN) {
        var msg = messages.genMessage(content);
        this._sendMsg(msg, procN);
    }

    sendRequest(content, procN, cb) {
        if (procN == null)
            return cb(new Error('Process identifier missing when sending request!'));
        if (procN < 0 || procN >= this.processes.length)
            return cb(new Error('Invalid process identifier: ' + procN));

        var self = this;

        try {
            var reqId = this._genReqId(procN);

            var req = messages.genRequest(content, reqId);
            var handler = function (e, res) {
                try {
                    if (e != null)
                        return cb(e);

                    console.log('Received response from process: ' + procN);

                    self._offResponse(procN, reqId, handler);
                    cb(undefined, res);
                } catch (e) {
                    console.error(e, 'Exception while processing response!');
                }
            }

            this._onResponse(procN, reqId, handler);
            this._sendMsg(req, procN);
        } catch (e) {
            cb(e);
        }
    }

    on(event, handler) {
        if (handler == null)
            throw new Error('Handler is null!');
        if (event != 'message')
            throw new Error('Invalid event name: ' + event);

        for (var procN = 0; procN < this.procMsgHandlerV.length; procN++) {
            this.procMsgHandlerV[procN][event].push(handler);
        }
    }

    off(event, procId, handler, reqId) {
        if (handler == null)
            throw new Error('Handler is null!');
        if (event != 'message')
            throw new Error('Invalid event name: ' + event);

        console.log('Removing handler ...');

        var handlers = this.procMsgHandlerV[procId][event];
        var handlerN = handlers.indexOf(handler);

        if (handlerN < 0)
            throw new Error('Cannot remove non-registered handler!');

        handlers.splice(handlerN, 1);
    }

    /*
     * Sends a message to one or all processes.
     *
     * @param {Object} msg - the message to send
     * @param {Integer} [processId] - the ID of the process, if missing the message will be sent to all the processes
     */
    _sendMsg(msg, procN) {
        if (procN != null) {
            if (procN < 0 || procN >= this.processes.length)
                throw new Error('Invalid process number: ' + procN);
            
            console.log('Sending message to slave ' + procN + ' ...');
            this.processes[procN].send(msg);            
        }
        else {
            console.log('Sending message to all slaves ...');
            for (var i = 0; i < this.processes.length; i++) {
                this._sendMsg(msg, i);
            }
        }
    }

    _onResponse(procId, reqId, handler) {
        var procHandlers = this.procReqHandlerV[procId];
        procHandlers[reqId] = {
            handler: handler,
            timestamp: new Date().getTime()
        };
    }

    _offResponse(procId, reqId, handler) {
        var procHandlers = this.procReqHandlerV[procId];
        delete procHandlers[reqId];
    }

    _initProcesses(processes) {
        this.processes = [];
        this.seqV = [];
        this.procMsgHandlerV = [];
        this.procReqHandlerV = [];

        var self = this;
        for (var i = 0; i < processes.length; i++) {
            (function () {
                var child = processes[i];
                var childPid = child.pid;
                var childId = i;

                child.on('error', (e) => {
                    console.error(e, 'Failed to start process:' + childPid);
                    // TODO
                });

                child.on('close', (code) => {
                    console.log('Slave ' + childPid + ' exited with code:' + code);
                    // TODO
                });

                child.on('message', (msg) => {
                    try {
                        console.log('Received message from child ' + childPid + ': ' + JSON.stringify(msg) + '...');

                        var type = msg.type;

                        switch(type) {
                            case 'message': {
                                var handlers = self.procMsgHandlerV[childId].message;
                                for (var handlerN = 0; handlerN < handlers.length; handlerN++) {
                                    var handler = handlers[handlerN];
                                    handler(childId, msg);
                                }
                                break;
                            }
                            case 'response': {
                                var reqId = msg.reqId;
                                var handlerH = self.procReqHandlerV[childId];
                                
                                if (reqId in handlerH) {
                                    var handler = handlerH[reqId].handler;
                                    var status = msg.status;

                                    if (status == 'error')
                                        handler(new Error(msg.content));
                                    else
                                        handler(undefined, msg.content);
                                    
                                    // the request has been processed, so remove the handler
                                    delete handlerH[reqId];
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
            this.procMsgHandlerV.push({
                message: []
            });
            this.procReqHandlerV.push({});
        }
    }

    _cleanupRespHandlers() {
        var timestamp = new Date().getTime();
        
        console.log('Cleaning up request handlers ...');

        for (var procId = 0; procId < this.procReqHandlerV.length; procId++) {
            var procHandlers = this.procReqHandlerV[procId];
            for (var reqId in procHandlers) {
                var handlerConf = procHandlers[reqId];
                if (timestamp - handlerConf.timestamp > REQUEST_TIMEOUT) {
                    console.log('Removing handler ' + handlerN + ' of process: ' + procId);

                    handlerConf.handler(new Error('Request timeout!'));
                    delete procHandlers[reqId];
                }
            }
        }
    }

    _genReqId(procId) {
        return this.seqV[procId]++;
    }
}

exports.slave = function (opts) {
    return new SlaveProcess(opts);
}

exports.master = function (opts) {
    return new MasterProcess(opts);
}
