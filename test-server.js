const https = require("https");
const express = require("express");
const caMaker = require("./cacerts.js");
const url = require("url");
const assert = require("assert");
const fetch = require("node-fetch");

// These two for the server to do resolution test
const dns = require('dns');
const dns2 = require("dns2");


const test = async function () {
    // Make a dns server
    const dnsServer = dns2.createServer((request, send) =>{
        const query = request.questions[0].name;
        const response = new dns2.Packet(request);
        
        console.log("got a dns request", query);
        
        // Send an address response
        response.header.qr = 1;
        response.header.ra = 1;
        response.answers.push({
            name: query,
            address: '127.0.0.1',
            type: dns2.Packet.TYPE.A,
            class: dns2.Packet.CLASS.IN,
            ttl: 300
        });
        send(response);
    })
    dnsServer.listen(15353);

    const resolver = new dns.Resolver();
    resolver.setServers(["127.0.0.1:15353"]);


    // Make the CA
    const { caCert, caAttrs, caKeyPair, issue } = caMaker.makeCa();

    // Make a CSR for our Cert Server ...
    const [privateKeyInPem, myPublicKeyInPem, csrInPem] = caMaker.makeCsr();
    // ... and issue the cert for the cert server.
    const {cert, ca} = issue(myPublicKeyInPem, csrInPem);
    
    const app = express();
    app.post("/cert", async function (req, res) {
        const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

        let dataBuf="";
        req.on("data", chunk => dataBuf = dataBuf + new String(chunk, "utf8"));
        await new Promise((resolve, reject) => req.on("end", resolve));

        const data = new url.URLSearchParams(dataBuf);

        // Get the dnsName for the cert from the request
        const dnsName = data.get("dnsname");

        const [err, resolved] = await new Promise((resolve, reject) => {
            resolver.resolve4(dnsName, (err, addresses) => {
                if (err !== null) {
                    reject(err);
                }
                else {
                    resolve(addresses);
                }
            });
        }).then(a => {return [undefined, a]}).catch(e => { return [e]});

        if (err !== undefined) {
            return res.sendStatus(403);
        }

        const ipv4 = ip.split(":").reverse()[0];
        if (resolved.includes(ipv4)) {
            const [privateKeyInPem, myPublicKeyInPem, csrInPem] = caMaker.makeCsr();
            // ... and issue the cert for the cert server.
            const {cert, ca} = issue(myPublicKeyInPem, csrInPem);
            return res.send(cert);
        }
        else {
            res.sendStatus(402);
        }
    });

    const tlsOpts = { key: privateKeyInPem, cert, ca };
    const testCertServerPort = 8443;
    const listener = https.createServer(tlsOpts, app).listen(testCertServerPort);
    https.globalAgent = new https.Agent({ ca: ca });

    try {
        const response = await fetch(`https://localhost:${testCertServerPort}/cert`, {
            method: "POST",
            agent: https.globalAgent,
            body: new url.URLSearchParams({dnsname: "my-test-server.com"})
        });

        console.log("status", response.status);

        const cert = await response.text()
        console.log(cert);
    }
    finally {
        listener.close();
        dnsServer.socket.close();
    }
};

test().then();

