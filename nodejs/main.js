'use strict';

const express = require('express');
const commandLineArgs = require('command-line-args');
const spawn = require('child_process').spawn;
const os = require('os');
const fs = require('fs');

const optionDefinitions = [
    { name: 'bypass-initial-test', type: String  },
    { name: 'configuration-file', type: String },
    { name: 'output-dir', type: String, defaultValue: os.tmpdir() },
    { name: 'output-file', type: String, defaultValue: "fastly-real-time-api-to-prometheus.data" },
    { name: 'verbose', alias: 'v', type: Boolean , defaultValue: false },
    { name: 'logs-dir', type: String, defaultValue: "/var/log"},
    { name: 'logs-file', type: String, defaultValue: "fastly-real-time-api-to-prometheus.log" },
    { name: 'port', type: Number, defaultValue: 9145 },
    { name: 'path', type: String, defaultValue: "/metrics" },
    { name: 'bash-script-location', type: String , defaultValue: "../fastly-real-time-api-to-prometheus.sh" }
  ]

const options = commandLineArgs(optionDefinitions)

function verbose(in_message) {
    if ( options.verbose != false) {
        console.log(in_message);
    }
}
function log(in_message) {
    console.log(in_message);
}

verbose(options)

function callScript(in_ouput_dir, in_output_file, in_callback) {
    var cmdArgs = `${options["bash-script-location"]} --output-dir ${in_ouput_dir} --output-file ${in_output_file}`.split(" ");
    if (options.verbose != false) {
        cmdArgs.push("-v")
    }
    if ( options["configuration-file"] != null ){
        cmdArgs.push("--configuration-file")
        cmdArgs.push(`${options["configuration-file"]}`)
    }
    var child = spawn("bash",cmdArgs);
    var error="";
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', function(data) {
        verbose(`${data.trim()}`);
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', function(data) {
        log(`stderr: ${data.trim()}`);
        error+=data.toString();
    });
    child.on('close', function(code) {
        in_callback(code, error)
    }); 
}

// App
const app = express();

if ( options["bypass-initial-test"] === undefined) {
    // Some checks, try to run the script
    log("Execute a dry run call as an initial test");
    var test_dir=os.tmpdir();
    var test_file="fastly-real-time-api-to-prometheus.test"
    callScript(test_dir, test_file ,(code, error) => {
        fs.unlink(`${test_dir}/${test_file}`, (err) => {console.log(err)})
        if ( code != 0 || error !== "") {
            throw new Error(`Error testing the script: code: ${code}, error: ${error}`); 
        } else {
            app.listen(options.port, () => {
                log("Dry run ok");
                log(`listening on port ${options.port} and path ${options.path}`)
            })
        }
    })
} else {
    app.listen(options.port, () => {
        log("Bypass initial test, no dry run");
        log(`listening on port ${options.port} and path ${options.path}`)
    })
}



app.get(options.path, (req, res) => {
    callScript(options["output-dir"], options["output-file"], (code, error) => {
        verbose(`closing code ${code}`);
        if ( code != 0 || error !== "") {
            res.status(500).send(`${error}`)
        } else {
            res.sendFile(`${options["output-dir"]}/${options["output-file"]}`)
        }
    })
});

