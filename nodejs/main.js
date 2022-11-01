'use strict';

const express = require('express');
const commandLineArgs = require('command-line-args');
const spawn = require('child_process').spawn;
const os = require('os');
const fs = require('fs');
var util = require('util');

const optionDefinitions = [
    { name: 'bypass-initial-test', type: String  },
    { name: 'configuration-file', type: String },
    { name: 'output-dir', type: String, defaultValue: os.tmpdir() },
    { name: 'output-file', type: String, defaultValue: "fastly-real-time-api-to-prometheus.data" },
    { name: 'verbose', alias: 'v', type: Boolean},
    { name: 'logs-dir', type: String, defaultValue: "/var/log"},
    { name: 'logs-file', type: String, defaultValue: "fastly-real-time-api-to-prometheus.log" },
    { name: 'nodejs-port', type: Number, defaultValue: 9145 },
    { name: 'nodejs-path', type: String, defaultValue: "/metrics" },
    { name: 'bash-script-location', type: String , defaultValue: "../fastly-real-time-api-to-prometheus.sh" },
    { name: 'fastly-key', type: String },
    { name: 'fastly-service-id', type: String }
  ]

const options = commandLineArgs(optionDefinitions)

String.prototype.replaceAll = function(search, replacement) {
    var target = this;
    return target.split(search).join(replacement);
};

if (options["configuration-file"] != null) {
    if(fs.existsSync(options["configuration-file"]) == false ) {
        throw new Error(`configuration file not found: ${options["configuration-file"]}`);  
    }
    fs.readFileSync(options["configuration-file"]).toString().split(/\r?\n/)
        .filter( line => line.startsWith("FRTATP_") && line.indexOf("=") > -1)
        .map( line => line.replace("FRTATP_","").replaceAll("_","-").toLowerCase())
        .forEach(line =>  {
            var [key,value] = line.split("=")
            var defaultValue = (optionDefinitions.find(od => od.name == key) || {defaultValue:null}).defaultValue
            if ( (options[key] == null || options[key] == defaultValue ) && value.length > 0) {
                options[key] = value
            }
        });
}

var init_errors = []
if ( options["logs-dir"] != null) {
    if (!fs.existsSync(options["logs-dir"])) {
        fs.mkdirSync(options["logs-dir"]);
    } 
}

if ( options["nodejs-port"] == null) {
    init_errors.push("nodejs-port must not be empty. Set FRTATP_NODEJS_PORT in the configuration file or add nodejs-port in the command line")
}

if ( options["nodejs-path"] == null) {
    init_errors.push("nodejs-path must not be empty. Set FRTATP_NODEJS_PATH in the configuration file or add nodejs-path in the command line")
}

if ( options["fastly-key"] == null) {
    init_errors.push("fastly-key must not be empty. Set FRTATP_FASTLY_KEY in the configuration file or add fastly-key in the command line")
} else {
    // hide the fastly-key
    options["fastly-key"] = "***"
}

if ( options["fastly-service-id"] == null) {
    init_errors.push("fastly-service-id must not be empty. Set FRTATP_FASTLY_SERVICE_ID in the configuration file or add fastly-service-id in the command line")
} else {    
    // hide the fastly-key
    options["fastly-service-id"] = "***"
}

if ( options["bash-script-location"] == null) {
    init_errors.push("bash-script-location must not be empty. Set FRTATP_BASH_SCRIPT_LOCATION in the configuration file or add bash-script-location in the command line")
} else {
    if(fs.existsSync(options["bash-script-location"]) == false ) {
        init_errors.push(`bash-script-location ${options["bash-script-location"]} does not exist. Check the location of the script`) 
    }
}

if (init_errors.length > 0) {
    throw new Error( "\r\n - " + init_errors.join("\r\n - ") + "\r\n");  
}

var log_file = null;
if ( options["logs-dir"] != null && options["logs-file"] != null) {
    log_file = fs.createWriteStream(`${options["logs-dir"]}/${options["logs-file"]}`, {flags : 'a'});
}
var log_stdout = process.stdout;

function verbose(in_message) {
    if ( options.verbose != null && options.verbose != false) {
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
    log(`Listening now on port ${options["nodejs-port"]} and path ${options["nodejs-path"]}`)
}

if ( options["bypass-initial-test"] === undefined) {
    // Some checks, try to run the script
    log("Execute a dry run call as an initial test");
    var test_dir=os.tmpdir();
    var test_file="fastly-real-time-api-to-prometheus.test"
    callScript(test_dir, test_file ,(code, error) => {
        fs.unlink(`${test_dir}/${test_file}`, (err) => {console.log(err)})
        if ( code != 0 || error !== "") {
            throw new Error(`While testing the script: code: ${code}, message: ${error}`); 
        } else {
            app.listen(options["nodejs-port"], () => {
                log("Dry run ok");
                ready()
            })
        }
    })
} else {
    app.listen(options["nodejs-port"], () => {
        log("Bypass initial test, no dry run");
        ready()
    })
}



app.get(options["nodejs-path"], (req, res) => {
    callScript(options["output-dir"], options["output-file"], (code, error) => {
        verbose(`closing code ${code}`);
        if ( code != 0 || error !== "") {
            res.status(500).send(`${error}`)
        } else {
            res.sendFile(`${options["output-dir"]}/${options["output-file"]}`)
        }
    })
});

