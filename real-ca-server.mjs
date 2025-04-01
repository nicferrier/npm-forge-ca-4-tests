#!/usr/bin/env node

import tls from "node:tls";
import https from "node:https";
import http from "node:http";   // needed for the http server to issue the ca cert
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import forge from "node-forge";
import caMaker from "./cacerts.js";
import fetch from "node-fetch";

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pki = forge.pki;

if (process.argv[2] === "help") {
    console.log(`A real CA maker and server distributor.

Use:

  node server.mjs init-ca <ca-domain>
         -- sets up a real CA in the directory ./realca for <ca-domain>

  node server.mjs start-ca [ <ca-cert port> <ca-server port> ]
         -- start up the real CA found in the directory ./realca

  node server.mjs make-cert [ <cert-file-prefix> ]
         -- talk o the server to obtain a certificate optionally saving it

The server has 2 open ports, by default:

  10080 - an HTTP port which returns the CA root certificate
  10443 - root certificated HTTPS which returns a new signed certificate

The 'ca-cert port' is the web port for fetching the base CA cert.

The 'ca-server port' is the port for the HTTPS CA server which will issue certs.

The 'make-cert' command will print the certificate, without a 'prefix'
but with a 'prefix' will use that to make files in the current
directory.

Additionally, 'make-cert' needs to know where the 'realca' directory
is, by default './realca' but it can also be specified with the
environment variable 'REALCADIR'.

See the README for more information.
`);
    process.exit(0);
}

const cwd = process.cwd();

// You can init a real ca like this
if (process.argv[2] === "init-ca") {
    if (process.argv[3] === undefined
        || process.argv[3] === "") {
        console.log("Error: you must specify a domain argument for the CA, eg: example.org");
        process.exit(1);
    }
    const commonName = process.argv[3];

    // Now setup the CA
    const realcaDir = path.join(cwd, "realca");

    const [dirErr] = await fs.promises.mkdir(realcaDir).then(r=>[]).catch(e=>[e]);
    if (dirErr && dirErr.code !== "EEXIST") {
        console.log("Error: could not create 'realca' dir because:", dirErr);
        process.exit(1);
    }

    const [caDomainWriteErr] = await fs.promises.writeFile(
        path.join(realcaDir, "cadomain.txt"), commonName, "utf8"
    ).then(r=>[]).catch(e=>[e]);
    if (caDomainWriteErr) {
        console.log("Error: could not save the domain name in the realca dir:", caDomainWriteErr);
        process.exit(1);
    }

    const caStuff = caMaker.makeCa({
        commonName
    });
    const {
        caCert,
        caPrivateKey,
        caPublicKey,
        getSerialNumber,
        issue
    } = caStuff;

    const privateKeyPem = pki.privateKeyToPem(caPrivateKey);
    await fs.promises.writeFile(
        path.join(realcaDir, "caprivatekey.pem"),
        privateKeyPem,
        "utf8"
    );

    const publicKeyPem = pki.publicKeyToPem(caPublicKey);
    await fs.promises.writeFile(
        path.join(realcaDir, "capublickey.pem"),
        publicKeyPem,
        "utf8"
    );

    const caCertPem = pki.certificateToPem(caCert);
    await fs.promises.writeFile(
        path.join(realcaDir, "cacert.pem"),
        caCertPem,
        "utf8"
    );

    const serial = getSerialNumber();
    await fs.promises.writeFile(
        path.join(realcaDir, "serial.num"),
        "" + serial,
        "utf8"
    );

    process.exit(0);
}


// This function starts the CA server -- it is advisable to keep only
// one of these going at once because it owns the serial number of
// the certs
//
// caCertServerPort is the port number that will be used for the HTTP
// server that can hand out the base CA cert
//
// caServerPort is the port number that will be used for the HTTPS
// port of the CA server; the server you can request a cert from
async function startCa(caCertServerPort=10080, caServerPort=10443) {
    const realcaDir = path.join(cwd, "realca");
    const [caPrivateKeyErr, caPrivateKeyText] = await fs.promises.readFile(
        path.join(realcaDir, "caprivatekey.pem"),
        "ascii"
    ).then(r=>[,r]).catch(e=>[e]);
    if (caPrivateKeyErr) {
        console.log("Error: cannot read private key:", caPrivateKeyErr);
        process.exit(1);
    }

    const privateKey = pki.privateKeyFromPem(caPrivateKeyText);

    const [caPublicKeyErr, caPublicKeyText] = await fs.promises.readFile(
        path.join(realcaDir, "capublickey.pem"),
        "ascii"
    ).then(r=>[,r]).catch(e=>[e]);
    if (caPublicKeyErr) {
        console.log("Error: cannot read public key:", caPublicKeyErr);
        process.exit(1);
    }

    const publicKey = pki.publicKeyFromPem(caPublicKeyText);


    const [caDomainErr, caDomain] = await fs.promises.readFile(
        path.join(realcaDir, "cadomain.txt"), "utf8"
    ).then(r=>[,r]).catch(e=>[e]);
    if (caDomainErr) {
        console.log("Error: cannot read ca domain file:", caDomainErr);
        process.exit(1);
    }

    const [caCertErr, caCertText] = await fs.promises.readFile(
        path.join(realcaDir, "cacert.pem"),
        "ascii"
    ).then(r=>[,r]).catch(e=>[e]);
    if (caCertErr) {
        console.log("Error: cannot read certificate:", caPublicKeyErr);
        process.exit(1);
    }

    const caCertificate = pki.certificateFromPem(caCertText, false, true);

    const [caSerialErr, caSerialText] = await fs.promises.readFile(
        path.join(realcaDir, "serial.num"),
        "ascii"
    ).then(r=>[,r]).catch(e=>[e]);
    if (caCertErr) {
        console.log("Error: cannot read serial number file:", caSerialErr);
        process.exit(1);
    }
    const serial = parseInt(caSerialText);
    
    const caStuff = caMaker.makeCa({
        commonName: caDomain,
        serialNumber: serial,
        certificate:caCertificate,
        privateKey,
        publicKey,
    });

    const {issue, getSerialNumber} = caStuff;

    // A function to make a cert .... used to initialize THIS server
    // as well as BY that https server to make the requested certs
    const makeCertFromCa = async function () {
        const [privateKeyInPem, publicKeyInPem, csrInPem] = caMaker.makeCsr();
        const {cert, ca} = issue(publicKeyInPem, csrInPem);
        const updatedSerial = getSerialNumber();
        await fs.promises.writeFile(
            path.join(realcaDir, "serial.num"),
            "" + updatedSerial,
            "utf8"
        );
        return {privateKeyInPem, cert};
    }

    // Make the actual cert
    const {privateKeyInPem, cert} = await makeCertFromCa();

    // Make a normal HTTP server to server the CA cert... obviously
    // this should be a keepie or something
    const caCertServer = http.createServer();
    caCertServer.on("request", (i,o) => {
        o.writeHead(200, {
            "content-type": "text/plain",
            "location": "https://localhost:10443"
        });
        o.end(caCertText);
    });
    const caCertServerListener = caCertServer.listen(caCertServerPort);


    const tlsOpts = {
        key: privateKeyInPem,  // comes from the makeCsr
        cert,
        ca: caCertText
    };
    const server = https.createServer(tlsOpts);
    server.on("request", async (i,o) => {
        if (i.method !== "POST") {
            o.writeHead(200);
            return o.end("try a POST to create a certificate");
        }
        // If it gets here it must be a POST
        const [certCreateErr, certRes] = await makeCertFromCa().then(r=>[,r]).catch(e=>[e]);
        if (certCreateErr) {
            console.log("error creating a certificate:", certCreateErr);
            o.writeHead(400);
            return o.end("some error occurred making your certificate");
        }
        const {privateKeyInPem, cert} = certRes;
        o.writeHead(201, {"content-type": "application/json"});
        o.end(JSON.stringify({privateKeyInPem, cert}));
    });
    const listener = await new Promise((t,c) => {
        const l = server.listen(caServerPort, _ => t(l));
    });

    console.log("ca cert server listening on:", caCertServerListener.address().port);
    console.log("server listening on:", listener.address().port);

    // Write the ca server port to a file
    await fs.promises.writeFile(
        path.join(realcaDir, "ca-server-port"),
        "" + caServerPort,
        "utf8"
    );

    return;
}

// Start a standalone CA server off the CA directory
//
// The idea here is that servers can fetch a new cert from here just
// by hitting it's endpoint.
//
// There is also an endpoint to fetch the CA cert for this server (the
// real-ca ca-cert) which means a server can use that ca-cert to talk
// to the ca-cert certificated endpoint for handing out certs from
// this CA.
if (process.argv[2] === "start-ca") {
    // start the server with ports from argv[3,4] ??
    const [httpPort, httpsPort] = (function () {
        return Object.values(arguments).map(arg => {
            const v = parseInt(arg);
            if (isNaN(v)) return undefined;
            return v;
        });
    })(process.argv[3], process.argv[4]);
    await startCa(httpPort, httpsPort);
}


if (process.argv[2] === "make-cert") {
    const realcaDir = process.env.REALCADIR??path.join(cwd, "realca");
    const [caDomainErr, caDomain] = await fs.promises.readFile(
        path.join(realcaDir, "cadomain.txt"), "utf8"
    ).then(r=>[,r]).catch(e=>[e]);
    if (caDomainErr) {
        console.log("Error: cannot read ca domain file:", caDomainErr);
        process.exit(1);
    }
    console.log("ca domain:", caDomain);

    const [caCertErr, caCertText] = await fs.promises.readFile(
        path.join(realcaDir, "cacert.pem"),
        "ascii"
    ).then(r=>[,r]).catch(e=>[e]);
    if (caCertErr) {
        console.log("Error: cannot read certificate:", caPublicKeyErr);
        process.exit(1);
    }

    // Get the current server port
    const [readPortErr, caServerPortStr] = await fs.promises.readFile(
        path.join(realcaDir, "ca-server-port"), "utf8"
    ).then(r=>[,r]).catch(e=>[e]);
    if (readPortErr) {
        console.log("could not find the server port:", readPortErr);
        process.exit(1);
    }

    const portNum = (function (a){
        const v = parseInt(a);
        if (isNaN(v)) return undefined;
        return v;
    })(caServerPortStr);

    if (portNum === undefined) {
        console.log("server port not an integer:", caServerPortStr);
    }


    const agent = new https.Agent({ca: caCertText});
    const [acquireErr, certRes] = await fetch(`https://localhost:${portNum}`, {
        agent,
        method: "POST"
    }).then(r=>[,r]).catch(e=>[e]);
    if (acquireErr  || certRes.status > 399) {
        console.log("failed to get a cert:", acquireErr??`https status: ${certRes.status}`);
        process.exit(1);
    }
    

    const certBodyResponse = await certRes.text();
    if (certRes.status !== 201) {
        console.log("failed to get a cert:", certBodyResponse);
        process.exit(1);
    }

    if (!certRes.headers.get("content-type").startsWith("application/json")) {
        console.log("unexpected cert response");
        process.exit(1);
    }
    const certData = JSON.parse(certBodyResponse);
    const {privateKeyInPem, cert} = certData;

    if (process.argv[3] === undefined) {
        console.log(`Private key:
${privateKeyInPem}

Certificate:
${cert}
`);
        process.exit(0);
    }

    await fs.promises.writeFile(
        path.join(process.cwd(), process.argv[3] + "_privatekey.pem"),
        privateKeyInPem,
        "utf8"
    );
    await fs.promises.writeFile(
        path.join(process.cwd(), process.argv[3] + "_cert.pem"),
        cert,
        "utf8"
    );
    process.exit(0);
}


// End

/* Local Variables:  */
/* mode: js           */
/* js-indent-level: 4 */
/* End:              */
