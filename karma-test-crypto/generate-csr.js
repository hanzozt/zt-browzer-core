
import {ZitiBrowzerCore} from "../dist/esm/index.js";



describe("test-generate-csr", function () {
  this.timeout(5000);

  beforeEach(async function () {
    this.ztBrowzerCore = new ZitiBrowzerCore();
    this.logger = this.ztBrowzerCore.createZitiLogger({
      logLevel: 'Trace',
      suffix: 'test-generate-csr'
    });

    this.logger.info(`beforeEach`);
  });

  it("generates a CSR", async function () {
    let ztContext = this.ztBrowzerCore.createZitiContext({
      logger: this.logger,
      controllerApi: 'bogus',
    });
    expect(ztContext).to.not.equal(undefined);
    await ztContext.initialize(); // this instantiates the OpenSSL WASM

    let pkey = ztContext.generateECKey({});
    this.logger.debug('pkey is: ', pkey);
    expect(pkey).to.not.equal(undefined);

    let csrPEM = ztContext.createCertificateSigningRequest({
      key: pkey,
    })
    this.logger.debug(csrPEM);
    expect(csrPEM).to.not.equal(undefined);
    expect(csrPEM.startsWith('-----BEGIN CERTIFICATE REQUEST-----\n')).to.be.true;
    expect(csrPEM.endsWith('-----END CERTIFICATE REQUEST-----\n')).to.be.true;

  });

});

