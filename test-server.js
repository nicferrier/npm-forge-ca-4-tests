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

        const certResponse = await fetch(
            `https://localhost:${certServicePort}/certificates?dnsname=my-test-server.com&version=2`, {
                agent: https.globalAgent
            });

        console.log("response from cert server>", certResponse.status);
        assert.ok(certResponse.status === 200);

        const certObject = await certResponse.json();
        
        // Now get the parts and start a service with the new cert
        const {ca:myCa, pkcs12, pkcs12password} = certObject;
        
        const myTlsApp = express();
        myTlsApp.get("/test", function (req, res) {
            res.send("<h1>Hello World!</h1>");
        });

        // Apparently we can't use the base64 that forge generates, so do this:
        const buf = Buffer.from(pkcs12, "base64");

        // Now tls opts based on just the PKCS12 data and the passphrase
        const myTlsOpts = {
            pfx: buf,
            passphrase: pkcs12password
        };

        const testTlsServerPort = 8444;
        const myTlsListener = https.createServer(myTlsOpts, myTlsApp)
              .listen(testTlsServerPort);

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
