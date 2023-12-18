'use strict';
const express = require('express');
const argumentParser = require('@edouardbe/command-line-arguments-configuration-file-environment-variables-parser');
const os = require('os');
const fs = require('fs');
var util = require('util');
const axios = require('axios');

const definitions = [
    { name: 'verbose', alias: 'v', type: Boolean, defaultIfMissing: false, defaultIfPresent: true, desc: "activate the verbose mode" },
    { name: 'bypass-initial-test', type: Boolean, defaultIfMissing: false, defaultIfPresent: true, desc: "used to bypass the initial test" },
    { name: 'configuration-file', type: String, desc: "location of the configuration file to read more variables" },
    { name: 'output-dir', type: String, defaultIfMissing: os.tmpdir(), desc: "the output directory where temporary data will be stored"  },
    { name: 'output-file', type: String, defaultIfMissing: "fastly-real-time-api-to-prometheus.data" , desc: "the output file where temporary data will be stored"  },
    { name: 'logs-dir', type: String, defaultIfMissing: "/var/log", dirCreateIfMissing: true, desc:"the directory to write the logs"},
    { name: 'logs-file', type: String, defaultIfMissing: "fastly-real-time-api-to-prometheus.log" , desc:"the file to write the logs" },
    { name: 'nodejs-port', type: 'integer', defaultIfMissing: 9145, required: true, desc:"the port to listen to" },
    { name: 'nodejs-path', type: String, defaultIfMissing: "/metrics", required: true,desc:"the path to listen to"},
    { name: 'fastly-key', type: String, obfuscate: true, required: true, desc:"the Fastly api key to authenticate to Fastly"},
    { name: 'fastly-service-id', type: String, obfuscate: true, desc:"the Fastly service id(s) to get the real-data, csv"},
    { name: 'ignore-metrics', type: String, desc:"semi-column separated values of metrics to ignore"},
    { name: 'ignore-counter-zero', type: Boolean, defaultIfMissing: true, defaultIfPresent: true, desc:"ignore the counter if the value is 0"},
    { name: 'metric-prefix', type: String, defaultIfMissing: "", desc:"add a prefix to all metrics for prometheus"},
    { name: 'background-execution-period', type: 'integer', defaultIfMissing: 120, desc:"nb seconds between the background execution if the endpoint is not called"}
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

class ExecutionQueue {
    constructor() {
      this.queue = [];
      this.isExecuting = false;
    }
  
    push(func) {
      return new Promise((resolve, reject) => {
        const task = async () => {
          try {
            this.isExecuting = true;
            resolve(await func());
          } catch (error) {
            reject(error);
          } finally {
            this.isExecuting = false;
            this.processQueue();
          }
        };
  
        this.queue.push(task);
        if (!this.isExecuting) {
          this.processQueue();
        }
      });
    }
  
    processQueue() {
      if (this.queue.length > 0 && !this.isExecuting) {
        const nextTask = this.queue.shift();
        nextTask();
      }
    }
  }

log(`Start at ${new Date()}` )

// verbose options
parsedArguments.getValuesAndSource().forEach(o => {
    verbose(`option ${o.name} is ${o.value} from ${o.from}`)
});

const axios_instance = axios.create({
    headers: {
        'Accept': 'application/json',
        'Fastly-Key': parsedArguments.get("fastly-key").replace(/^"/, "").replace(/"$/, "")
    }
});

// return [{id: ,name: ,version:}]
function getAllFastlyServicesPromise() {
    return axios_instance.get('https://api.fastly.com/service', { params: {page: 1, per_page: 200 }})
    .then(res => res.data.map( d => { return {id : d.id, name : d.name, version : d.version};}))
}

function filterServices(services) {
    var fastly_service_ids = parsedArguments.get("fastly-service-id")
    if (fastly_service_ids != null && fastly_service_ids != "") {
        services = services.filter( s =>  fastly_service_ids.indexOf(s.id) > -1 )
    }
    return services
}

function getRealTimeMetricsPromise(service, timestamp) {
    return axios_instance.get(`https://rt.fastly.com/v1/channel/${service.id}/ts/${timestamp}`)
    .then( res => res.data.Data)
}

/*[{
        "code": "ADL",
        "name": "Adelaide",
        "group": "Asia/Pacific",
        "region": "APAC",
        "stats_region": "anzac",
        "billing_region": "Australia",
        "coordinates": {
            "x": 0,
            "y": 0,
            "latitude": -34.9285,
            "longitude": 138.6007
        }
}]*/
// return an object { "ABC : { region: }"}
function getAllFastlyPoPsPromise() {
    return axios_instance.get('https://api.fastly.com/datacenters')
    .then(res => {
        var pops = {}
        res.data.forEach( p => pops[p.code] = { region : p.billing_region})
        return pops
    })
}

function loadPreviousDataPromise(in_previous_data_file) {
    return new Promise((resolve, reject) => {
        if (fs.existsSync(in_previous_data_file)) {
            fs.readFile(in_previous_data_file, (err,data) => {
                if(err) {
                    log(err)
                    reject(err)
                } else {
                    if ( data != "") {
                        var obj = JSON.parse(data)

                        if (obj.timestamp < (new Date()).setHours(0, 0, 0, 0)) {
                            log("erasing previous counter")
                            resolve({})
                        } else {
                            resolve(obj)
                        }
                    } else {
                        resolve( [])
                    }
                } 
            })
        } else {
            resolve([])
        }   
    });
}

function saveToFilePromise(in_previous_data_file, array, is_background){
    var obj = {}
    obj.previous_data = array;
    obj.timestamp = new Date();
    obj.is_background = is_background;
    return new Promise((resolve, reject) => {
        fs.writeFile(in_previous_data_file, JSON.stringify(obj), (err) => err ? reject(err) : resolve())
    })       
}

// service is {id:, name:, version:}
// previous_data is {  "recorded" : 123 , "datacenter" :{ "ABC"" : { metrics }}}
// datacenter_codes is ["ABC,"DEF"]
function getNewDataPromise(service, previous_data) {
    // need the last recorded timestamp, or "h" is missing, "h" is from Fastly API doc.
    var last_recorded_timestamp = (previous_data || {})["recorded"] || "h"
    return getRealTimeMetricsPromise(service, last_recorded_timestamp)
}

// previous_data is {  "recorded" : 123 , "datacenter" :{ "ABC"" : { metrics }}}
// new_data is  [ { "recorded" : 123, "datacenter" : { "ABC" : { metrics }}} ]
// datacenter_codes is ["ABC,"DEF"]
// is_previous_background : if true, accumulate the histograms, else reset the histograms
function mergeData(previous_data, new_data, is_previous_background) {
    
    // reduce the metrics
    // merged_data will be { "recorded" : 123 , "datacenter" :{ "ABC"" : { metrics }}}
    return new_data.reduce( (acc, cur) => {
        Object.entries(cur.datacenter).forEach( ([datacenter,metrics]) => {
            acc.datacenter[datacenter] = acc.datacenter[datacenter] || {};
            Object.entries(metrics).forEach( ([key, value]) => {
                if ( (parsedArguments.get("ignore-metrics") || "").split(";").find( m => key.indexOf(m) > -1 ) == null) {
                    if (key.indexOf("histogram") > -1) { 
                        acc.datacenter[datacenter][key] = acc.datacenter[datacenter][key] || {}
                        
                        Object.entries(value).forEach( ([bucket_key, bucket_value]) => {
                            acc.datacenter[datacenter][key][bucket_key] = ( is_previous_background ? (acc.datacenter[datacenter][key][bucket_key] || 0) : 0 ) + bucket_value;
                        })    
                    } else {
                        acc.datacenter[datacenter][key] = (acc.datacenter[datacenter][key] || 0) + value
                    }
                }
            })
        })
        acc.recorded = Math.max(cur.recorded , acc.recorded|| 0)
        return acc
    }, previous_data || {datacenter : {}});
}

// services is [{id:,name:,version:}]
// datacenters is [code:,region:}]
// merged_data_array is [{ "service" : 123, "recorded" : 123 , "datacenter" :{ "ABC"" : { metrics }}}]
function json2prometheus(merged_data_array, pops, services) {

    var result = []
    var prefix = parsedArguments.get("metric-prefix")

    // add the services and their info for dependency in grafana
    result.push(`# HELP ${prefix}services ${prefix}services`)
    result.push(`# TYPE ${prefix}services gauge`)
    services.forEach(s => result.push(`${prefix}services{ser="${s.id}",name="${s.name}",version="${s.version}"} 1`))

    // add the datacenters (renamed pop ) and their regions for dependency in grafana
    result.push(`# HELP ${prefix}pops ${prefix}pops`)
    result.push(`# TYPE ${prefix}pops gauge`)
    Object.entries(pops).forEach(([k,v]) => {
        result.push(`${prefix}pops{pop="${k}",reg="${v.region}"} 1`)
    })

    // need to transform the merged_data_array [{ "recorded" : 123 , "datacenter" :{ "ABC"" : { metrics }}}] into { metric : [service_123:, pop: , value: ]}}
    var translated_metrics = {}
    // for each service
    merged_data_array.forEach( merged_data_service => {
        // for each pop
        Object.entries(merged_data_service.datacenter).forEach( ([ datacenter, metrics ]) => {
            // for each metric
            Object.entries(metrics).forEach( ([key, value]) => {
                translated_metrics[key] = translated_metrics[key] || []
                translated_metrics[key].push( { service : merged_data_service.service, pop : datacenter, value: value} );
            })
        })
    })

    // All the status_XXX will be handled in a status object
    var status = {}
    // All the tls_XXX will be handled in a tls object
    var tls = {}
    // All the object_size_XXX will be handled in a object_size object
    var object_size = {}
    // Need to add buckets for prometheus to compute properly percentiles
    
    // for each metrics
    Object.entries(translated_metrics).forEach( ([metric_name, values]) => {
        // for histogram
        if (metric_name.indexOf("_histogram") > -1) {
            
            var histogram_buckets = values.map( v => Object.keys(v.value).map(v => parseInt(v))).flat().filter((value, index, array) => array.indexOf(value) === index )
            histogram_buckets.sort((a,b) => parseInt(a) - parseInt(b));
            
            var histogram = {} 
            values.forEach( v => {
                histogram[v.service] = histogram[v.service] || {}
                histogram[v.service][v.pop] = histogram[v.service][v.pop] || {}
                Object.entries(v.value).forEach( ([bucket_key, bucket_value]) => histogram[v.service][v.pop][bucket_key] = bucket_value )
            })  

            result.push(`# HELP ${prefix}${metric_name} ${prefix}${metric_name}`)
            result.push(`# TYPE ${prefix}${metric_name} histogram`)
            Object.entries(histogram).forEach( ([service, popss]) => {
                Object.entries(popss).forEach( ([pop, buckets]) => {
                    var count = 0;
                    var sum = 0;
                    histogram_buckets.forEach( bucket => {
                        var nb = buckets[bucket] || 0
                        count += nb;
                        result.push(`${prefix}${metric_name}_bucket{pop="${pop}",reg="${pops[pop].region}",ser="${service}",le="${bucket}"} ${count}`);
                        sum += (nb * parseInt(bucket))
                    })
                    result.push(`${prefix}${metric_name}_bucket{pop="${pop}",reg="${pops[pop].region}",ser="${service}",le="+Inf"} ${count}`); 
                    result.push(`${prefix}${metric_name}_count{pop="${pop}",reg="${pops[pop.region]}",ser="${service}"} ${count}`);
                    result.push(`${prefix}${metric_name}_sum{pop="${pop}",reg="${pops[pop].region}",ser="${service}"} ${sum}`);
                })
            })
        } else if (metric_name.indexOf("status_") == 0) {
            var code = metric_name.substring("status_".length)
            values.forEach( v => {
                status[v.service] = status[v.service] || {}
                status[v.service][v.pop] = status[v.service][v.pop] || {}
                status[v.service][v.pop][code] = v.value
            })  
        } else if (metric_name.indexOf("object_size_") == 0) {
            var size = metric_name.substring("object_size_".length)
            values.forEach( v => {
                object_size[v.service] = object_size[v.service] || {}
                object_size[v.service][v.pop] = object_size[v.service][v.pop] || {}
                object_size[v.service][v.pop][size] = v.value
            })  
        } else if (metric_name.indexOf("tls_") == 0) {
            var code = metric_name.substring("tls_".length)
            values.forEach( v => {
                tls[v.service] = tls[v.service] || {}
                tls[v.service][v.pop] = tls[v.service][v.pop] || {}
                tls[v.service][v.pop][code] = v.value
            })  
        } else if (metric_name == "tls") {
            var code = "XXX"
            values.forEach( v => {
                tls[v.service] = tls[v.service] || {}
                tls[v.service][v.pop] = tls[v.service][v.pop] || {}
                tls[v.service][v.pop][code] = v.value
            })  
        } else {
            result.push(`# HELP ${prefix}${metric_name} ${prefix}${metric_name}`)
            result.push(`# TYPE ${prefix}${metric_name} counter`)
            values.forEach( v => {
                if ( v.value != 0 || parsedArguments.get("ignore-counter-zero") == false ) {
                    result.push(`${prefix}${metric_name}{pop="${v.pop}",reg="${pops[v.pop].region}",ser="${v.service}"} ${v.value}`)
                }
            })
        }
    })
    
    result.push(`# HELP ${prefix}status ${prefix}status`)
    result.push(`# TYPE ${prefix}status counter`)
    Object.entries(status).forEach( ([service, s_pops]) => {
        Object.entries(s_pops).forEach( ([pop, values]) => {
            Object.entries(values).forEach( ([code, value]) => {
                result.push(`${prefix}status{pop="${pop}",reg="${pops[pop].region}",ser="${service}",code="${code}"} ${value}`)
            })
        })
    })

    result.push(`# HELP ${prefix}object_size ${prefix}object_size`)
    result.push(`# TYPE ${prefix}object_size counter`)
    Object.entries(object_size).forEach( ([service, s_pops]) => {
        Object.entries(s_pops).forEach( ([pop, values]) => {
            Object.entries(values).forEach( ([size, value]) => {
                result.push(`${prefix}object_size{pop="${pop}",reg="${pops[pop].region}",ser="${service}",size="${size}"} ${value}`)
            })
        })
    })

    result.push(`# HELP ${prefix}tls ${prefix}tls`)
    result.push(`# TYPE ${prefix}tls counter`)
    Object.entries(tls).forEach( ([service, s_pops]) => {
        Object.entries(s_pops).forEach( ([pop, values]) => {
            Object.entries(values).forEach( ([version, value]) => {
                result.push(`${prefix}tls{pop="${pop}",reg="${pops[pop].region}",ser="${service}",version="${version}"} ${value}`)
            })
        })
    })

    result.push(`# HELP ${prefix}last_timestamp ${prefix}last_timestamp`)
    result.push(`# TYPE l${prefix}ast_timestamp counter`)
    merged_data_array.forEach(service => {
        if (service.recorded) {
            result.push(`${prefix}last_timestamp{ser="${service.service}"} ${service.recorded}`)
        }
    })

    return result.join("\n");
}

function callScriptPromise(previous_data_file_path, is_background) {
    var start = new Date();
    return Promise.all([
        getAllFastlyPoPsPromise(),
        loadPreviousDataPromise(previous_data_file_path),
        getAllFastlyServicesPromise().then(services => filterServices(services))
    ])
    .then( ([pops, previous_data_obj, services]) => 
        Promise.all(
            services.map( service => {
                var previous_data = (previous_data_obj.previous_data || []).find( p => p.service == service.id)
                return getNewDataPromise(service, previous_data)
                .then( new_data => {
                    var merged_data = mergeData(previous_data, new_data, previous_data_obj.is_background)
                    merged_data.service = service.id
                    return merged_data
                })
            })
        ).then( merged_data_array =>
            Promise.all([
                saveToFilePromise(previous_data_file_path, merged_data_array, is_background),
                json2prometheus(merged_data_array, pops, services)
            ])
        )
    )
    .then( ([ _, prometheus_data]) => prometheus_data )
    .finally(() => {
        var end = new Date()
        var duration = ((end.getTime() - start.getTime())/1000).toFixed(3)
        log(`execution duration in ${is_background ? "backgound" : "foreground"} took ${duration}s`)
    })
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
    var test_file=parseInt(Math.random()*Number.MAX_SAFE_INTEGER)
    
    callScriptPromise(`${test_dir}${test_file}`)
    .then( data => {
        fs.unlink(`${test_dir}${test_file}`, (err) => {console.log(err)})
        app.listen(parsedArguments.get("nodejs-port"), () => {
            verbose(data)
            log("Dry run ok");
            ready()
        })
    }).catch( error => {
        throw error;
    }) 
} else {
    app.listen(parsedArguments.get("nodejs-port"), () => {
        log("Bypass initial test, no dry run");
        ready()
    })
}
var execution_timer = null;
const execution_queue = new ExecutionQueue();

function execute(file_path, is_background) {
    if ( execution_timer != null ) {
        clearTimeout(execution_timer);
    }

    return execution_queue.push( () => callScriptPromise(file_path, is_background)
        .finally( () => {  
            if ( execution_timer != null ) {
                clearTimeout(execution_timer);
            }
            var delay = parsedArguments.get("background-execution-period")
            if (delay > 0) {
                execution_timer = setTimeout(() => {
                    verbose("execute in the background")
                    execute(`${parsedArguments.get("output-dir")}/${parsedArguments.get("output-file")}`, true)
                }, delay*1000);
            }
        })
    )
};

app.get(parsedArguments.get("nodejs-path"), (req, res) => {
    execute(`${parsedArguments.get("output-dir")}/${parsedArguments.get("output-file")}`, false)
    .then( data => {
        res.status(200).send(data)
    })
    .catch( error => {
        log(error)
        res.status(500).send(error)
    })
});
