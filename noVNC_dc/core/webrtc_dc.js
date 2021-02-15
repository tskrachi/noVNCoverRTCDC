'use strict';

import '/socket.io/socket.io.js';

export default class webrtc_dc {
    MAX_CONNECTION_COUNT = 2;

    constructor(uri, options, cb) {
        this._roomid = options.roomid || '';
        this._socket = io.connect(`https://${uri}/`);
        this.peerConnections = [];
        this.initiator = false;
        this.dataChannel = null;
        this._pc_config = options.iceServers || [];
        this._max_conn_cnt = 2;
        this.registHandler(cb);
    }

    get readyState() {
        if (this.dataChannel) {
            return this.dataChannel.readyState;
        } else {
            return "closed"
        }
    }

    init(uri, options, cb) {
        this._socket = io.connect(`https://${uri}/`);
        this.registHandler(cb);
        this._roomid = options.roomid || "";
        this._pc_config = options.iceServers || [];
    }

    registHandler(cb) {
        if (this._socket) {
            this._socket.on('connect', (evt) => {
                this._socket.emit('enter', this._roomid);
            });
            this._socket.on('message', (message) => {
                let fromId = message.from;
            
                if (message.type === 'offer') {
                    let offer = new RTCSessionDescription(message);
                    this.setOffer(fromId, offer, cb);
                }
                else if (message.type === 'answer') {
                    let answer = new RTCSessionDescription(message);
                    this.setAnswer(fromId, answer);
                }
                else if (message.type === 'candidate') {
                    let candidate = new RTCIceCandidate(message.ice);
                    this.addIceCandidate(fromId, candidate);
                }
                else if (message.type === 'call me') {
                    if (! this.isReadyToConnect()) {
                        console.log('Not ready to connect, so ignore');
                        return;
                    }
                    else if (! this.canConnectMore()) {
                        console.warn('TOO MANY connections, so ignore');
                    }
              
                    if (this.isConnectedWith(fromId)) {
                        // already connnected, so skip
                        console.log('already connected, so ignore');
                    }
                    else {
                        // connect new party
                        this.makeOffer(fromId, cb);
                    }
                }
                else if (message.type === 'bye') {
                    if (this.isConnectedWith(fromId)) {
                        this.stopConnection(fromId);
                    }
                }
            });
            this._socket.on('user disconnected', (evt) => {
                console.log('====user disconnected==== evt:', evt);
                let id = evt.id;
                if (this.isConnectedWith(id)) {
                    this.stopConnection(id);
                }
            });
        }
    }

    emitRoom(msg) {
        this._socket.emit('message', msg);
    }

    emitTo(id, msg) {
        msg.sendto = id;
        this._socket.emit('message', msg);
    }

    getConnectionCount() {
        return this.peerConnections.length;
    }

    isReadyToConnect() {
        // if (localStream) {
          return true;
        // }
        // else {
        //   return false;
        // }
    }

    canConnectMore() {
        return (this.getConnectionCount() < this._max_conn_cnt);
    }

    isConnectedWith(id) {
        if (this.peerConnections[id])  {
            return true;
        }
        return false;
    }
    
    addConnection(id, peer) {
        this.peerConnections[id] = peer;
    }
    
    getConnection(id) {
        let peer = this.peerConnections[id];
        return peer;
    }

    deleteConnection(id) {
        delete this.peerConnections[id];
    }

    stopConnection(id) {
        if (this.isConnectedWith(id)) {
            let peer = this.getConnection(id);
            peer.close();
            this.deleteConnection(id);
        }
    }

    stopAllConnection() {
        for (let id in this.peerConnections) {
            this.stopConnection(id);
        }
    }

    sendSdp(id, sessionDescription) {
        console.log('---sending sdp ---');
    
        let message = { type: sessionDescription.type, sdp: sessionDescription.sdp };
        console.log('sending SDP=' + message);
    
        this.emitTo(id, message);
    }

    sendIceCandidate(id, candidate) {
        console.log('---sending ICE candidate ---');
        let obj = { type: 'candidate', ice: candidate };
    
        if (this.isConnectedWith(id)) {
            this.emitTo(id, obj);
        }
        else {
            console.warn('connection NOT EXIST or ALREADY CLOSED. so skip candidate');
        }
    }

    // ---------------------- connection handling -----------------------
    prepareNewConnection(id, cb) {
        let pc_config = this._pc_config;
        let peer = new RTCPeerConnection(pc_config);

        // --- on get remote stream ---
        if ('ontrack' in peer) {
            peer.ontrack = (event) => {
                let stream = event.streams[0];
                console.log('-- peer.ontrack() stream.id=' + stream.id);
            };
        }
        else {
            peer.onaddstream = (event) => {
                let stream = event.stream;
                console.log('-- peer.onaddstream() stream.id=' + stream.id);
            };
        }

        // --- on get local ICE candidate
        peer.onicecandidate = (evt) => {
            if (evt.candidate) {
                console.log(evt.candidate);

                // Trickle ICE
                this.sendIceCandidate(id, evt.candidate);
            } else {
                console.log('empty ice event');
            }
        };

        // --- when need to exchange SDP ---
        peer.onnegotiationneeded = (evt) => {
            console.log('-- onnegotiationneeded() ---');
        };

        // --- other events ----
        peer.onicecandidateerror = (evt) => {
            console.error('ICE candidate ERROR:', evt);
        };

        peer.onsignalingstatechange = () => {
            console.log('== signaling status=' + peer.signalingState);
        };

        peer.oniceconnectionstatechange = () => {
            console.log('== ice connection status=' + peer.iceConnectionState);
            if (peer.iceConnectionState === 'disconnected') {
                console.log('-- disconnected --');
                this.stopConnection(id);
            }
        };

        peer.onicegatheringstatechange = () => {
            console.log('==***== ice gathering state=' + peer.iceGatheringState);
        };
    
        peer.onconnectionstatechange = () => {
            console.log('==***== connection state=' + peer.connectionState);
        };

        peer.onremovestream = (event) => {
            console.log('-- peer.onremovestream()');
            this.deleteRemoteStream(id);
        };
    
        // if (localStream) {
        //     console.log('Adding local stream...');
        //     peer.addStream(localStream);
        // }
        // else {
        //     console.warn('no local stream, but continue.');
        // }

        // -- data channel --
        if (!this.initiator) {
            console.log('--- createDataChannel ---')
            this.dataChannel = peer.createDataChannel(this._roomid, {ordered : true, maxRetransmitTime: 3000});
            cb(this.dataChannel);
        }
        return peer;
    }

    makeOffer(id, cb) {

        let peerConnection = this.prepareNewConnection(id, cb);
        this.addConnection(id, peerConnection);
    
        peerConnection.createOffer()
        .then( (sessionDescription) => {
          console.log('createOffer() succsess in promise');
          return peerConnection.setLocalDescription(sessionDescription);
        }).then(() => {
            console.log('setLocalDescription() succsess in promise');
    
            // -- Trickle ICE の場合は、初期SDPを相手に送る -- 
            this.sendSdp(id, peerConnection.localDescription);
    
            // -- Vanilla ICE の場合には、まだSDPは送らない --
        }).catch((err) => {
            console.error(err);
        });
    }

    setOffer(id, sessionDescription, cb) {
        let peerConnection = this.prepareNewConnection(id, cb);
        this.addConnection(id, peerConnection);
        
        peerConnection.setRemoteDescription(sessionDescription)
        .then(() => {
            console.log('setRemoteDescription(offer) succsess in promise');
            this.makeAnswer(id, cb);
        }).catch((err) => {
            console.error('setRemoteDescription(offer) ERROR: ', err);
        });
    }

    makeAnswer(id, cb) {
        console.log('sending Answer. Creating remote session description...' );
        let peerConnection = this.getConnection(id);
        if (! peerConnection) {
          console.error('peerConnection NOT exist!');
          return;
        }
        
        peerConnection.createAnswer()
        .then((sessionDescription) => {
          console.log('createAnswer() succsess in promise');
          return peerConnection.setLocalDescription(sessionDescription);
        }).then(() => {
          if (this.initiator) {
            console.log('regist data channel.');
            peerConnection.ondatachannel = (evt) => {
                this.dataChannel = evt.channel;
                cb(this.dataChannel);
            }
          }
          console.log('setLocalDescription() succsess in promise');
    
          // -- Trickle ICE の場合は、初期SDPを相手に送る -- 
          this.sendSdp(id, peerConnection.localDescription);
    
          // -- Vanilla ICE の場合には、まだSDPは送らない --
        }).catch((err) => {
          console.error(err);
        });
    }
    setAnswer(id, sessionDescription) {
        let peerConnection = this.getConnection(id);
        if (! peerConnection) {
            console.error('peerConnection NOT exist!');
            return;
        }
    
        peerConnection.setRemoteDescription(sessionDescription)
        .then(() => {
            console.log('setRemoteDescription(answer) succsess in promise');
        }).catch((err) => {
            console.error('setRemoteDescription(answer) ERROR: ', err);
        });
    }
    
      // --- tricke ICE ---
    addIceCandidate(id, candidate) {
        if (! this.isConnectedWith(id)) {
            console.warn('NOT CONNEDTED or ALREADY CLOSED with id=' + id + ', so ignore candidate');
            return;
        }
        
        let peerConnection = this.getConnection(id);
        if (peerConnection) {
            peerConnection.addIceCandidate(candidate);
        }
        else {
            console.error('PeerConnection not exist!');
            return;
        }
    }
}