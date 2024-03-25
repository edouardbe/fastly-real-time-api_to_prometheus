const nock = require("nock");
const request = require("supertest");
const chai = require("chai");
const chaiHttp = require("chai-http");
const expect = chai.expect;
chai.use(chaiHttp);
const path = require("path");
const fs = require("fs");
const app = require("../main.js");

function mock_json_data(file_in_mocks_folder) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "mocks", file_in_mocks_folder), "utf-8"));
}

describe("test main app", () => {
  let expected_output_test1, expected_output_test2_after_background_call, expected_output_test2_after_background_and_foreground_calls, expected_output_test2_after_background_and_2_foreground_calls;

  before(() => {
    nock("https://api.fastly.com").persist().get("/datacenters").reply(200, mock_json_data("fastly_datacenters_endpoint.json"));

    nock("https://api.fastly.com")
      .persist()
      .get(/\/service\?.*/)
      .reply(200, mock_json_data("fastly_service_endpoint_ABC_service.json"));

    nock("https://rt.fastly.com").persist().get("/v1/channel/ABC/ts/h").reply(200, mock_json_data("fastly_realtime_endpoint_ABC_service_h.json"));

    nock("https://rt.fastly.com")
      .persist()
      .get(/\/v1\/channel\/ABC\/ts\/[0-9]+/)
      .reply(200, mock_json_data("fastly_realtime_endpoint_ABC_service_1703049052.json"));

    expected_output_test1 = fs.readFileSync(path.join(__dirname, "expected_output", "test1.txt"), "utf8");

    expected_output_test2_after_background_call = fs.readFileSync(path.join(__dirname, "expected_output", "test2_after_one_background_call.txt"), "utf8");

    expected_output_test2_after_background_and_foreground_calls = fs.readFileSync(path.join(__dirname, "expected_output", "test2_after_one_background_and_foreground_calls.txt"), "utf8");

    expected_output_test2_after_background_and_2_foreground_calls = fs.readFileSync(path.join(__dirname, "expected_output", "test2_after_one_background_and_2_foreground_calls.txt"), "utf8");
  });

  after(function (done) {
    nock.cleanAll();
    done();
  });

  it("should call the real-time api and return the expected result", function (done) {
    request(app)
      .get("/metrics?background=true")
      .expect(200)
      .end((err, res) => {
        if (err) return done(err);
        expect(res).to.have.status(200);
        expect(res.text).to.equal(expected_output_test1);

        request(app)
          .get("/metrics?background=true")
          .expect(200)
          .end((err, res) => {
            if (err) return done(err);
            expect(res).to.have.status(200);
            expect(res.text).to.equal(expected_output_test2_after_background_call);

            request(app)
              .get("/metrics")
              .expect(200)
              .end((err, res) => {
                if (err) return done(err);
                expect(res).to.have.status(200);
                expect(res.text).to.equal(expected_output_test2_after_background_and_foreground_calls);

                request(app)
                  .get("/metrics")
                  .expect(200)
                  .end((err, res) => {
                    if (err) return done(err);
                    expect(res).to.have.status(200);
                    expect(res.text).to.equal(expected_output_test2_after_background_and_2_foreground_calls);

                    done();
                  });
              });
          });
      });
  });
});
