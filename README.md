# Make CAs for testing

If you're testing certs issued by CAs it would be nice to use a real
CA to do that.... but you don't necessarily want to embed certs from
your real CA for testing.

The best scenario would perhaps be some sort of ACME... but if you
don't have that then you might need this which allows you to create a
purely fake CA and issues certs from it easily.


## How to install?

Like this:

```
npm i @nicferrier/forge-test-ca
```

You'll need at least node `v10` I think, but to be honest I only test on
the latest nodes. Currently, at time of writing that's `v22`.

## Why would I use this?

This is a useful development/testing library but there is also a real
ca server that will hand out certificates on HTTP requests.

This is not an ACME server but it is still useful for situations where
you don't want application code to have mixed https/http
situations. In development call this server for a certifacte. In
production do whatever you have to do.


## Make a CA

That's easy:

```javascript
const caMaker = require("@nicferrier/forge-test-ca");
const {
    caCert,
    caAttrs,
    caKeyPair,
    issue
} = caMaker.makeCa();

```

As you can see the call to make the CA makes everything you need:

* the ca certificate itself
* the ca attributes as a separate structure
* the private/public key pair underpinning the ca
* `issue` is a function that can issue certs for this ca 

## Make a CSR to get a cert from that CA

If you want a cert, the normal Internet flow would be make a CSR and
send it to your CSR with some sort of proof that you owned the name
being requested.

We don't need the proof because this is just for testing:

```javascript
const caMaker = require("@nicferrier/forge-test-ca");
const [privateKeyInPem, publicKeyInPem, csrInPem] = caMaker.makeCsr();
```

Note how it makes all the stuff you would normally need:

* the private and public keys for you, not the CA one
* the CSR itself - the file you'd normally mail or web POST to the CA


## Have the CA issue a cert for the CSR

That's just the two above combined:

```javascript
const caMaker = require("@nicferrier/forge-test-ca");

// First make the ca ...
const {
    caCert,
    caAttrs,
    caKeyPair,
    issue  // this is a function used to issue certs based on CSRs
} = caMaker.makeCa();

// ... then make the csr ...
const [privateKeyInPem, myPublicKeyInPem, csrInPem] = caMaker.makeCsr();

// ... finally, have the ca you made sign the CSR using the `issue` function
const {cert, ca} = issue(myPublicKeyInPem, csrInPem);
```

The return is `cert`, the certificate signed by the ca and the `ca`
certificate.

You already have the `ca` certificate in this example, in `caCert`
from the creation of the ca, but that might not be the flow you have
in your code all the time.

## How do I make an end to end test with this?

Here's a full example:

```javascript
const https = require("https");
const express = require("express");
const caMaker = require("@nicferrier/forge-test-ca");

const { caCert, caAttrs, caKeyPair, issue } = caMaker.makeCa();
const [privateKeyInPem, myPublicKeyInPem, csrInPem] = caMaker.makeCsr();
const {cert, ca} = issue(myPublicKeyInPem, csrInPem);

const app = express();
app.get("/", function (req, res) { res.send("hello world"); });

const tlsOpts = {
  key: privateKeyInPem,  // comes from the makeCsr
  cert, ca
};

const listener = https.createServer(tlsOpts, app).listen(8443);

https.globalAgent = new https.Agent({ ca });

https.get("https://localhost:8443", { agent: https.globalAgent }, response => {
  let rawData = '';
  response.on('data', (chunk) => { rawData += chunk; });
  response.on('end', () => {
    try {
      console.log("response was: " + rawData);
    } catch (e) {
      console.error(e.message);
    }
  });
}).end();

```

this is basically replicated in the [test-ca.js](test-ca.js) file in
this repository.


## PKCS12?

An alternative to the cert and the private key is a PKCS12 package.

These are also available, though there is an extra step. 

Going from the CSR step, it's:

```javascript
const [privateKeyInPem, myPublicKeyInPem, csrInPem] = caMaker.makeCsr();
const {cert, ca, getPkcs12} = issue(myPublicKeyInPem, csrInPem);
const {pkcs12, pkcs12password} = getPkcs12(privateKeyInPem);
```

Note that the `issue` call actually returns a function called
`getPkcs12` which then returns the cert and key packaged as the
PKCS12 form.

You can also specify the password to the PKCS12 generation, which is
then used by you later to unpack the PKCS12:

```javascript
const [privateKeyInPem, myPublicKeyInPem, csrInPem] = caMaker.makeCsr();
const {cert, ca, getPkcs12} = issue(myPublicKeyInPem, csrInPem);
const {pkcs12, pkcs12password} = getPkcs12(privateKeyInPem, "very secret");
```

By default the password is allocated as a fixed string embedded in
this code.


## Using a server that makes a certificate for you

ACME is great. But in some environments (internal certificates
perhaps?) ACME is overkill for getting certs.

One alternative is to have an internal CA that verifies ownership via
DNS:

```
  Client                               Cert Server
  
  GET ?dnsname=internal.example.com
                                       Check DNS internal.example.com
                                       resolves to same address as request 
                                       address,
                                       
                                       no? send error
                                       
                                       yes? make cert and send back
  Use cert to start safe server
```

If you have such a service internally you can code to it. But how to test?

This project includes a service that does this Cert Server function,
but for a generated certificate.

Here's how to use it:

```javascript
const https = require("https");
const url = require("url");
const express = require("express");   // for the server we will start when we have a cert
const fetch = require("node-fetch");  // to call the cert server

const simpleCertService = require("@nicferrier/forge-test-ca").simpleCertService;

const {
    listener: certServiceListener,
    dnsServer,
    port: certServicePort,
    ca
} = await simpleCertService();

try {
   https.globalAgent = new https.Agent({ ca: ca });
   // Make the endpoint configurable to for non-development environment
   const endpoint = `localhost:${certServicePort}/certificates`; 

   // The name that this server is bound to
   const dnsName = "my-test-server.com";
   // The 'version=2' makes the request return a PKCS12 response 
   const certServerUrl = `https://${endpoint}?dnsname=${dnsName}&version=2`;

   const certResponse = await fetch(certServerUrl, { agent: https.globalAgent });
   const { pkcs12, pkcs12password } = await certResponse.json();

   // Now start a server with this
   const app = express();
   app.get("/test", function (req, res) {
      res.send("<h1>Hello World!</h1>");
   });

   const opts = { 
      pfx: Buffer.from(pkcs12, "base64"), 
      passphrase: pkcs12password
   };
   const port = 8444;
   const listener = https.createServer(opts, app).listen(port);

   console.log("listening on", listener.address().port);
}
finally {
   // In a test situation you might want to stop these things
   certServiceListener.close();
   dnsServer.socket.close();
}
```

There is a [test for the cert server](test-server.js) in this
repository which does basically this.

### Configuring the test server

When creating the `simple-test-service` you can supply configuration options:


* `certServerPort` - the port the mock certificate server will run on
* `certificateObjectKeyName` - the key name for the PKCS12 encoded certificate in the certificate JSON
* `privateKeyPasswordObjectKeyName` - the key name for password of the PKCS12 private key in the certificate JSON
* `certificateAuthorityObjectKeyName` - the key name for the certificate authority that generated the certificate in the certificate JSON


### Notes and Issues with the Cert Server

It actually uses a fake DNS server to do the resolution of the cert,
just like a real implementation would use DNS.

But the DNS server is both slow to start and to resolve. So any test
of this will always suffer seconds of delay.

The DNS server simply always returns `127.0.0.1` for whatever it is
queryed.

The embedded server has a GET on the `/certificates` path which
returns a PKCS12 with a password. If your actual implementation has
some other contract then this code isn't much use and it's tricky for
me to make something generic.

But you could just copy the code and make it the server contract you
want.

Could it be a real cert server? Probably, without too much work it
could. But the management of certs is very dependent on how an
organisation works. So this is left as an exercise for the reader.


## How about that real CA server?

The _real_ CA server is a server that will make a CA and persist state
and continuously hand out certs.

It can be stopped and restarted and it will just continue where it
left off.

So it's very like a CA server implementation might look but it's a lot
simpler.

You can initialze the server like this:

```
$ nicferrier-real-ca init-ca
```

This will make a `realca` directory in the current directory. That
directory will contain the state of the CA.

You can then start the server like this:

```
$ nicferrier-real-ca start-ca
```

That will fail if it can't find the `realca` directory in the current
directory.

The server starts an HTTP server on port `10080` which can be used to
fetch the root certificate.

It also starts an HTTPS server on port `10443` which is identified by
a cert from the same root certificate chain. This server has an
endpoint that can create another certificate and so can be used by
application code.

So you can then fetch a CA with this code:

```javascript
import fetch from "node-fetch";
import url from "node:url";

// The URL we want a certificate for
const hostingUrl = new url.URL("https://localhost:8000");
// Let's try and get the cert from remote cert server
const caUrl = "http://localhost:10080";
console.log(`fetching certificate from ${caUrl}...`);
const [caCertFetchErr, caCertFetchRes] = await fetch(caUrl).then(r=>[,r]).catch(e=>[e]);
if (caCertFetchErr || caCertFetchRes.status !== 200) {
    console.log("Aborting because cannot fetch the CA cert:",
                caCertFetchErr??`http: ${caCertFetchRes.status}`);
    process.exit(1);  // we could c(error) instead
}

const caCertPemData = await caCertFetchRes.text();
const tlsEndpointLocation = caCertFetchRes.headers.get("location");
console.log("tls cert fetch endpoint location:", tlsEndpointLocation);

const agent = new https.Agent({ca: caCertPemData });

// Now get the actual cert we'll start this webserver with
const [certFetchErr, certFetchRes] = await fetch(tlsEndpointLocation, {
    method: "POST",
    agent
}).then(r=>[,r]).catch(e=>[e]);
if (certFetchErr || certFetchRes.status !== 201) {
    console.log("Aborting because can't make certificate:",
                certFetchErr??`http: ${certFetchRes.status}`);
    process.exit(1);  // we could c(error) instead
}
const certJson = await certFetchRes.json();
const {privateKeyInPem, cert} = certJson;

console.log("received certificate");

// Start my app server with the certificate
const tlsOpts = {
    key: privateKeyInPem,
    cert
};

const myAppServerListener = new Promise((t,c) => {
    const listener = https.createServer(tlsOpts, (request, response) => {
        res.writeHead(200);                            
        res.end('hello world\n');
    }).listen(hostingUrl.port, _ => t(listener));
});
```

## Thanks node-forge!

This project wouldn't have been possible without
[node-forge](https://www.npmjs.com/package/node-forge), which is a
totally awesome set of crypto and pki algorithms implementations.


_fin_
