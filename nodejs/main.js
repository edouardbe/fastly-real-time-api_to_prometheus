'use strict';

const express = require('express');
const commandLineArgs = require('command-line-args');
const spawn = require('child_process').spawn;
const os = require('os');
const fs = require('fs');
var util = require('util');
const { off } = require('process');

String.prototype.replaceAll = function(search, replacement) {
    var target = this;
    return target.split(search).join(replacement);
};

class Options {

    constructor(option_definitions, env_var_prefix, configuration_file_argument) {
        this.options = {};
        this.errors = [];
        this.env_var_prefix = env_var_prefix;

        // read the environment variables first
        optionDefinitions.forEach(od => {
            this.options[od.name] = {};
            this.options[od.name]["od"] = od;
            this.options[od.name]["env"] = process.env[this.toEnvVarName(od.name)];  
        },this);

        // read the command line options
        Object.entries(commandLineArgs(optionDefinitions)).forEach( ([key, value]) => {
            this.options[key]["cl"] = value;  
        }, this);

        
        // read the configuration file options if present
        const configuration_file = this.get(configuration_file_argument)
        if (configuration_file != null) {
            if(fs.existsSync(configuration_file) == false ) {
                throw new Error(`configuration file not found: ${configuration_file}`);  
            }
            fs.readFileSync(configuration_file).toString().split(/\r?\n/)
                .filter( line => line.match(`\\b(${this.env_var_prefix}[^=]+=[^=]+)\\b`, 'g') != null)
                .forEach(line =>  {
                    var [key,value] = line.split("=")
                    var l_argkey = this.toArgName(key)
                    if (this.options[l_argkey] != null) {
                        this.options[l_argkey]["cf"] = value; 
                    }
                }, this);
        }

        Object.entries(this.options).forEach( ([key,obj]) => {
            var value = this.get(key)
            if ( obj.od.dirCreateIfMissing === true && this.mustNotBeEmpty(key)) {
                if (!fs.existsSync(value)) {
                    fs.mkdirSync(value);
                } 
            }
            if ( obj.od.required == true ) {
                this.mustNotBeEmpty(key) 
            }
            if ( obj.od.fileMustExist === true && this.mustNotBeEmpty(key)) {
                this.mustFileExit(key)  
            }
        });

        if (this.errors.length > 0) {
            throw new Error( "\r\n - " + this.errors.join("\r\n - ") + "\r\n");  
        }

    }

    toEnvVarName(in_key) {
        return `${this.env_var_prefix}${in_key.toUpperCase().replaceAll("-","_")}`
    }
    toArgName(in_key) {
        return in_key.replace(this.env_var_prefix,"").replaceAll("_","-").toLowerCase()
    }

    mustNotBeEmpty=function(in_key) {
        var value = this.get(in_key);
        if ( value == null) {
            this.errors.push(`${in_key} must not be empty. Set ${this.toEnvVarName(in_key)} in the configuration file or environment variable or add ${in_key} in the command line`);
            return false
        }
        return true
    }
    mustFileExit=function(in_key) {
        var file = this.get(in_key)
        if ( file == null || fs.existsSync(file ) == false ) {
            this.errors.push(`${in_key} ${file} does not exist.`) 
        }
    }

    get = function(in_key) {
        var obj = this.options[in_key];
        return  obj["cl"] || obj["cf"] || obj["env"] || obj.od.default;
    }

    getFromCommandLine = function(in_key) {
        var obj = this.options[in_key];
        return obj["cl"];
    }

    hasValue = function(in_value) {
        return in_value != null && in_value != undefined
    }

    takenFrom = function(in_key) {
        var obj = this.options[in_key];
        return this.hasValue(obj["cl"]) ? "command line" : (this.hasValue(obj["cf"]) ? "configuration file" : (this.hasValue(obj["env"]) ? "environment variable" : (this.hasValue(obj.od.default) ? "default value" :  "nowhere")) ) ;
    }
    
    getValuesAndSource = function() {
       return Object.entries(this.options).map( ([key,obj]) => {
            console.log(obj)
            return {
                name : key,
                value : obj.od.obfuscate == true ? "****" : this.get(key),
                from : this.takenFrom(key)
            }
        }, this )
    }
}

const optionDefinitions = [
    { name: 'bypass-initial-test', type: Boolean, default: false, desc: "any value, used to bypass the initial test" },
    { name: 'configuration-file', type: String, desc: "location of the configuration file to read more variables" },
    { name: 'output-dir', type: String, default: os.tmpdir(), desc: "the output directory where temporary data will be stored"  },
    { name: 'output-file', type: String, default: "fastly-real-time-api-to-prometheus.data" , desc: "the output file where temporary data will be stored"  },
    { name: 'verbose', alias: 'v', type: Boolean, default: false, desc: "activate the verbose mode" },
    { name: 'logs-dir', type: String, default: "/var/log", dirCreateIfMissing: true, desc:"the directory to write the logs"},
    { name: 'logs-file', type: String, default: "fastly-real-time-api-to-prometheus.log" , desc:"the file to write the logs" },
    { name: 'nodejs-port', type: Number, default: 9145, required: true, desc:"the port to listen to" },
    { name: 'nodejs-path', type: String, default: "/metrics", required: true,desc:"the path to listen to"},
    { name: 'bash-script-location', type: String , default: "../fastly-real-time-api-to-prometheus.sh", required: true, fileMustExist: true, desc:"the location of the bach script" },
    { name: 'fastly-key', type: String, obfuscate: true, required: true, desc:"the Fastly api key to authenticate to Fastly"},
    { name: 'fastly-service-id', type: String, obfuscate: true, required: true, desc:"the Fastly service id to get the real-data"},
    { name: 'ignore-metrics', type: String, desc:"semi-column separated values of metrics to ignore"}
  ]

const options = new Options(optionDefinitions, "FRTATP_",'configuration-file')

const log_file = fs.createWriteStream(`${options.get("logs-dir")}/${options.get("logs-file")}`, {flags : 'a'});
const log_stdout = process.stdout;

function verbose(in_message) {
    if ( options.get("verbose") != null && options.get("verbose") != false) {
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
options.getValuesAndSource().forEach(o => {
    verbose(`option ${o.name} is ${o.value} from ${o.from}`)
});

function callScript(in_ouput_dir, in_output_file, in_callback) {
    var cmdArgs = `${options.get("bash-script-location")} --output-dir ${in_ouput_dir} --output-file ${in_output_file}`.split(" ");
    if (options["verbose"] != false) {
        cmdArgs.push("-v")
    }
    var configuration_file = options.get("configuration-file")
    if ( configuration_file != null ){
        cmdArgs.push("--configuration-file")
        cmdArgs.push(`${configuration_file}`)
    }
    var cl_fastly_key = options.getFromCommandLine("fastly-key");
    if ( cl_fastly_key != null ){
        cmdArgs.push("--fastly-key")
        cmdArgs.push(`${cl_fastly_key}`)
    }
    var cl_fastly_service_id = options.getFromCommandLine("fastly-service-id");
    if ( cl_fastly_service_id != null ){
        cmdArgs.push("--fastly-service-id")
        cmdArgs.push(`${cl_fastly_service_id}`)
    }
    var cl_ignore_metrics = options.getFromCommandLine("ignore-metrics");
    if ( cl_ignore_metrics != null ){
        cmdArgs.push("--ignore-metrics")
        cmdArgs.push(`${cl_ignore_metrics}`)
    }
    var cl_verbose = options.getFromCommandLine("verbose");
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
    log(`Listening now on port ${options.get("nodejs-port")} and path ${options.get("nodejs-path")}`)
}

if ( options.get("bypass-initial-test") == false) {
    // Some checks, try to run the script
    log("Execute a dry run call as an initial test");
    var test_dir=os.tmpdir();
    var test_file="fastly-real-time-api-to-prometheus.test"
    callScript(test_dir, test_file ,(code, error) => {
        fs.unlink(`${test_dir}/${test_file}`, (err) => {console.log(err)})
        if ( code != 0 || error !== "") {
            throw new Error(`While testing the script: code: ${code}, message: ${error}`); 
        } else {
            app.listen(options.get("nodejs-port"), () => {
                log("Dry run ok");
                ready()
            })
        }
    })
} else {
    app.listen(options.get("nodejs-port"), () => {
        log("Bypass initial test, no dry run");
        ready()
    })
}

app.get(options.get("nodejs-path"), (req, res) => {
    callScript(options.get("output-dir"), options.get("output-file"), (code, error) => {
        verbose(`closing code ${code}`);
        if ( code != 0 || error !== "") {
            res.status(500).send(`${error}`)
        } else {
            res.sendFile(`${options.get("output-dir")}/${options.get("output-file")}`)
        }
    })
});

