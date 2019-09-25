const https = require("https");
const express = require("express");
const caMaker = require("./cacerts.js");
const url = require("url");
const assert = require("assert");
const fetch = require("node-fetch");
const simpleCertService = require("./simple-cert-service.js");

const test = async function () {
    const {
        listener: certServiceListener,
        dnsServer,
        port: certServicePort,
        ca
    } = await simpleCertService();

    try {
        https.globalAgent = new https.Agent({ ca: ca });
        const certResponse = await fetch(`https://localhost:${certServicePort}/cert`, {
            method: "POST",
            agent: https.globalAgent,
            body: new url.URLSearchParams({dnsname: "my-test-server.com"})
        });

        console.log("response from cert server>", certResponse.status);
        assert.ok(certResponse.status === 200);

        // Now get the parts and start a service with the new cert
        const {cert:myCert,ca:myCa,privateKey:myPrivateKey} = await certResponse.json();
        
        const myTlsApp = express();
        myTlsApp.get("/test", function (req, res) {
            res.send("<h1>Hello World!</h1>");
        });

        const myTlsOpts = { key: myPrivateKey, cert: myCert, ca: myCa };
        const testTlsServerPort = 8444;
        const myTlsListener = https.createServer(myTlsOpts, myTlsApp).listen(testTlsServerPort);

        // Now connect to that service
        try {
            const opts = { agent: new https.Agent({ca:myCa}) };
            const response = await fetch(`https://localhost:${testTlsServerPort}/test`);
            console.log("test server fetch status>", response.status);
            assert.ok(response.status === 200);
            const testBody = await response.text();
            console.log("test server fetch body>", testBody);
            assert.deepStrictEqual(testBody, "<h1>Hello World!</h1>");
        }
        finally {
            myTlsListener.close();
        }
    }
    finally {
        certServiceListener.close();
        dnsServer.socket.close();
    }
};

test().then();

// End
