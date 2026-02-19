
import {ZitiBrowzerCore} from "../dist/esm/index.js";



describe("test-generate-ec-key", function () {
  this.timeout(5000);

  beforeEach(async function () {
    this.ztBrowzerCore = new ZitiBrowzerCore();
    this.logger = this.ztBrowzerCore.createZitiLogger({
      logLevel: 'Trace',
      suffix: 'test-generate-ec-key'
    });

    this.logger.info(`beforeEach`);
  });

  it("generates an EC keypair", async function () {
    let ztContext = this.ztBrowzerCore.createZitiContext({
      logger: this.logger,
      controllerApi: 'bogus',
    });
    expect(ztContext).to.not.equal(undefined);
    await ztContext.initialize(); // this instantiates the OpenSSL WASM

    let pkey = ztContext.generateECKey({});
    this.logger.debug('pkey is: ', pkey);
    expect(pkey).to.not.equal(undefined);

    let privateKeyPEM = ztContext.getPrivateKeyPEM(pkey);
    this.logger.debug(privateKeyPEM);
    expect(privateKeyPEM).to.not.equal(undefined);
    expect(privateKeyPEM.startsWith('-----BEGIN PRIVATE KEY-----\n')).to.be.true;
    expect(privateKeyPEM.endsWith('-----END PRIVATE KEY-----\n')).to.be.true;

    let publicKeyPEM = ztContext.getPublicKeyPEM(pkey);
    this.logger.debug(publicKeyPEM);
    expect(publicKeyPEM).to.not.equal(undefined);
    expect(publicKeyPEM.startsWith('-----BEGIN PUBLIC KEY-----\n')).to.be.true;
    expect(publicKeyPEM.endsWith('-----END PUBLIC KEY-----\n')).to.be.true;

  });

});

