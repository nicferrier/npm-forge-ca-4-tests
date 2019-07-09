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

You'll need at least node v10 I think.

There is no binary or anything here, it's only useful as a development
(in fact, just a testing) library.


## Make a CA

That's easy

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


## Thanks node-forge!

This project wouldn't have been possible without node-forge, which is
a totally awesome set of crypto and pki algorithms implementations.

