'use strict';

const express = require('express');
const argumentParser = require('@edouardbe/command-line-arguments-configuration-file-environment-variables-parser');
const spawn = require('child_process').spawn;
const os = require('os');
const fs = require('fs');
var util = require('util');

const definitions = [
    { name: 'verbose', alias: 'v', type: Boolean, defaultIfMissing: false, defaultIfPresent: true, desc: "activate the verbose mode" },
    { name: 'bypass-initial-test', type: Boolean, defaultIfMissing: false, defaultIfPresent: true, desc: "used to bypass the initial test" },
    { name: 'configuration-file', type: String, desc: "location of the configuration file to read more variables" },
    { name: 'output-dir', type: String, defaultIfMissing: os.tmpdir(), desc: "the output directory where temporary data will be stored"  },
    { name: 'output-file', type: String, defaultIfMissing: "fastly-real-time-api-to-prometheus.data" , desc: "the output file where temporary data will be stored"  },
    { name: 'logs-dir', type: String, defaultIfMissing: "/var/log", dirCreateIfMissing: true, desc:"the directory to write the logs"},
    { name: 'logs-file', type: String, defaultIfMissing: "fastly-real-time-api-to-prometheus.log" , desc:"the file to write the logs" },
    { name: 'nodejs-port', type: Number, defaultIfMissing: 9145, required: true, desc:"the port to listen to" },
    { name: 'nodejs-path', type: String, defaultIfMissing: "/metrics", required: true,desc:"the path to listen to"},
    { name: 'bash-script-location', type: String , defaultIfMissing: "../fastly-real-time-api-to-prometheus.sh", required: true, fileMustExist: true, desc:"the location of the bach script" },
    { name: 'fastly-key', type: String, obfuscate: true, required: true, desc:"the Fastly api key to authenticate to Fastly"},
    { name: 'fastly-service-id', type: String, obfuscate: true, required: true, desc:"the Fastly service id to get the real-data"},
    { name: 'ignore-metrics', type: String, desc:"semi-column separated values of metrics to ignore"}
  ]

const options = {
    envVarPrefix: "FRTATP_",
    cfgFileArg: 'configuration-file'
}

const parsedArguments = argumentParser(definitions, options);
            

const log_file = fs.createWriteStream(`${parsedArguments.get("logs-dir")}/${parsedArguments.get("logs-file")}`, {flags : 'a'});
const log_stdout = process.stdout;

function verbose(in_message) {
    if ( parsedArguments.get("verbose") != null && parsedArguments.get("verbose") != false) {
        log(in_message);
    }
}
function log(in_message) {
    if (log_file != null) {
        log_file.write(util.format(in_message) + '\n');
    }
    log_stdout.write(util.format(in_message) + '\n');
}

log(`Start at ${new Date()}` )

// verbose options
parsedArguments.getValuesAndSource().forEach(o => {
    verbose(`option ${o.name} is ${o.value} from ${o.from}`)
});

function callScript(in_ouput_dir, in_output_file, in_callback) {
    var cmdArgs = `${parsedArguments.get("bash-script-location")} --output-dir ${in_ouput_dir} --output-file ${in_output_file}`.split(" ");
    if (options["verbose"] != false) {
        cmdArgs.push("-v")
    }
    var configuration_file = parsedArguments.get("configuration-file")
    if ( configuration_file != null ){
        cmdArgs.push("--configuration-file")
        cmdArgs.push(`${configuration_file}`)
    }
    var cl_fastly_key = parsedArguments.getFromCommandLine("fastly-key");
    if ( cl_fastly_key != null ){
        cmdArgs.push("--fastly-key")
        cmdArgs.push(`${cl_fastly_key}`)
    }
    var cl_fastly_service_id = parsedArguments.getFromCommandLine("fastly-service-id");
    if ( cl_fastly_service_id != null ){
        cmdArgs.push("--fastly-service-id")
        cmdArgs.push(`${cl_fastly_service_id}`)
    }
    var cl_ignore_metrics = parsedArguments.getFromCommandLine("ignore-metrics");
    if ( cl_ignore_metrics != null ){
        cmdArgs.push("--ignore-metrics")
        cmdArgs.push(`${cl_ignore_metrics}`)
    }
    var cl_verbose = parsedArguments.getFromCommandLine("verbose");
    if ( cl_verbose != null ) {
        cmdArgs.push("--verbose")
    }

    var child = spawn("bash",cmdArgs);
    var error="";
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', function(data) {
        verbose(`${data.trim()}`);
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', function(data) {
        log(`${data.trim()}`);
        error+=data.toString();
    });
    child.on('close', function(code) {
        in_callback(code, error)
    }); 
}

// App
const app = express();

function ready() {
    log(`Listening now on port ${parsedArguments.get("nodejs-port")} and path ${parsedArguments.get("nodejs-path")}`)
}

if ( parsedArguments.get("bypass-initial-test") == false) {
    // Some checks, try to run the script
    log("Execute a dry run call as an initial test");
    var test_dir=os.tmpdir();
    var test_file="fastly-real-time-api-to-prometheus.test"
    callScript(test_dir, test_file ,(code, error) => {
        fs.unlink(`${test_dir}/${test_file}`, (err) => {console.log(err)})
        if ( code != 0 || error !== "") {
            throw new Error(`While testing the script: code: ${code}, message: ${error}`); 
        } else {
            app.listen(parsedArguments.get("nodejs-port"), () => {
                log("Dry run ok");
                ready()
            })
        }
    })
} else {
    app.listen(parsedArguments.get("nodejs-port"), () => {
        log("Bypass initial test, no dry run");
        ready()
    })
}

app.get(parsedArguments.get("nodejs-path"), (req, res) => {
    callScript(parsedArguments.get("output-dir"), parsedArguments.get("output-file"), (code, error) => {
        verbose(`closing code ${code}`);
        if ( code != 0 || error !== "") {
            res.status(500).send(`${error}`)
        } else {
            res.sendFile(`${parsedArguments.get("output-dir")}/${parsedArguments.get("output-file")}`)
        }
    })
});

