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
    { name: 'background-execution-period', type: 'integer', defaultIfMissing: 120, desc:"nb seconds between the background execution if the endpoint is not called"},
    { name: 'miss-latency-percentiles', type: String, defaultIfMissing: "10,25,50,75,90,95", desc:"list of the percentiles to compute for the miss latency. Put an empty string if you don't want the percentiles to be computed"},
    { name: 'miss-latency-histograms', type: Boolean, defaultIfMissing: true, desc:"enable/disable to add the miss latency buckets"}
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

function computePercentileValue(buckets, count, percentile) {
    var index = parseInt(count * percentile / 100)
    // Convert keys to numbers and sort them
    var sortedBucketKeys = Object.keys(buckets).sort((a, b) => a - b);

    for (let key of sortedBucketKeys) {
        // Check if the index is smaller than the current value
        if (index < buckets[key]) {
            let minValue, span;
            if (key <= 10) {
                span = 1;
            } else if (key <= 250) {
                span = 10;
            } else if (key <= 1000) {
                span = 50;
            } else {
                span = 100;
            }
            minValue = key - span;
            const maxValue = key;

            // Calculate the weighted average
            return Math.round(minValue + (index * (maxValue - minValue) / buckets[key]));
        }
        // Decrement the index by the value for this key
        index -= buckets[key];
    }

    // Return null if no key is found (index out of range)
    return null;
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

    // need to transform the merged_data_array [{ "recorded" : 123 , "datacenter" :{ "ABC"" : { metrics }}}] into { metric : [{service:, pop: , value: }]}}
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
        // values is [{service:, pop: , value: }]

        // for miss histogram
        if (metric_name == "miss_histogram") {

            var histogram = {}
            values.forEach( v => {
                histogram[v.service] = histogram[v.service] || { overall : { buckets : {}, count : 0, sum : 0}, per_pop : {}, per_region : {} }
                histogram[v.service]["per_pop"][v.pop] = histogram[v.service]["per_pop"][v.pop] || {buckets : {}, count : 0, sum : 0}
                histogram[v.service]["per_region"][pops[v.pop].region] = histogram[v.service]["per_region"][pops[v.pop].region] || {buckets : {}, count : 0, sum : 0}

                Object.entries(v.value).forEach( ([bucket_key, bucket_value]) => {
                    var bucket_int = parseInt(bucket_key)
                    histogram[v.service]["overall"]["buckets"][bucket_int] = (histogram[v.service]["overall"]["buckets"][bucket_int] || 0 ) + bucket_value;
                    histogram[v.service]["overall"]["count"] += bucket_value;
                    histogram[v.service]["overall"]["sum"] += (bucket_value * bucket_int);

                    histogram[v.service]["per_pop"][v.pop]["buckets"][bucket_int] = (histogram[v.service]["per_pop"][v.pop]["buckets"][bucket_int] || 0 ) + bucket_value;
                    histogram[v.service]["per_pop"][v.pop]["count"] += bucket_value;
                    histogram[v.service]["per_pop"][v.pop]["sum"] += (bucket_value * bucket_int);

                    histogram[v.service]["per_region"][pops[v.pop].region]["buckets"][bucket_int] = (histogram[v.service]["per_region"][pops[v.pop].region]["buckets"][bucket_int] || 0 ) + bucket_value;
                    histogram[v.service]["per_region"][pops[v.pop].region]["count"] += bucket_value;
                    histogram[v.service]["per_region"][pops[v.pop].region]["sum"] += (bucket_value * bucket_int);
                })
            })

            if (parsedArguments.get("miss-latency-histograms") == true) {
                result.push(`# HELP ${prefix}${metric_name}_per_service ${prefix}${metric_name}_per_service`)
                result.push(`# TYPE ${prefix}${metric_name}_per_service histogram`)
                Object.entries(histogram).forEach( ([service, service_object]) => {

                    var sortedBucketKeys = Object.keys(service_object["overall"]["buckets"]).sort((a, b) => a - b);
                    var acc = 0;
                    for (let key of sortedBucketKeys) {
                        acc += service_object["overall"]["buckets"][key]
                        result.push(`${prefix}${metric_name}_per_service_bucket{ser="${service}",le="${key}"} ${acc}`);
                    }
                    result.push(`${prefix}${metric_name}_per_service_bucket{ser="${service}",le="+Inf"} ${acc}`);
                    result.push(`${prefix}${metric_name}_per_service_count{ser="${service}"} ${service_object["overall"]["count"]}`);
                    result.push(`${prefix}${metric_name}_per_service_sum{ser="${service}"} ${service_object["overall"]["sum"]}`);
                })

                result.push(`# HELP ${prefix}${metric_name}_per_service_region ${prefix}${metric_name}_per_service_region`)
                result.push(`# TYPE ${prefix}${metric_name}_per_service_region histogram`)
                Object.entries(histogram).forEach( ([service, service_object]) => {
                    Object.entries(service_object["per_region"]).forEach( ([region, region_object]) => {
                        var sortedBucketKeys = Object.keys(region_object["buckets"]).sort((a, b) => a - b);
                        var acc = 0;
                        for (let key of sortedBucketKeys) {
                            acc += region_object["buckets"][key]
                            result.push(`${prefix}${metric_name}_per_service_region_bucket{reg="${region}",ser="${service}",le="${key}"} ${acc}`);
                        }
                        result.push(`${prefix}${metric_name}_per_service_region_bucket{reg="${region}",ser="${service}",le="+Inf"} ${acc}`);
                        result.push(`${prefix}${metric_name}_per_service_region_count{reg="${region}",ser="${service}"} ${region_object["count"]}`);
                        result.push(`${prefix}${metric_name}_per_service_region_sum{reg="${region}",ser="${service}"} ${region_object["sum"]}`);
                    })
                })

                result.push(`# HELP ${prefix}${metric_name}_per_service_pop ${prefix}${metric_name}_per_service_pop`)
                result.push(`# TYPE ${prefix}${metric_name}_per_service_pop histogram`)
                Object.entries(histogram).forEach( ([service, service_object]) => {
                    Object.entries(service_object["per_pop"]).forEach( ([pop, pop_object]) => {
                        var sortedBucketKeys = Object.keys(pop_object["buckets"]).sort((a, b) => a - b);
                        var acc = 0;
                        for (let key of sortedBucketKeys) {
                            acc += pop_object["buckets"][key]
                            result.push(`${prefix}${metric_name}_per_service_pop_bucket{pop="${pop}",reg="${pops[pop].region}",ser="${service}",le="${key}"} ${acc}`);
                        }
                        result.push(`${prefix}${metric_name}_per_service_pop_bucket{pop="${pop}",reg="${pops[pop].region}",ser="${service}",le="+Inf"} ${acc}`);
                        result.push(`${prefix}${metric_name}_per_service_pop_count{pop="${pop}",reg="${pops[pop].region}",ser="${service}"} ${pop_object["count"]}`);
                        result.push(`${prefix}${metric_name}_per_service_pop_sum{pop="${pop}",reg="${pops[pop].region}",ser="${service}"} ${pop_object["sum"]}`);
                    })
                })
            }

            // compute the percentiles
            var percentiles = {};
            (parsedArguments.get("miss-latency-percentiles") || "").split(",").flat().map(Number).forEach( p => {
                // per service
                Object.entries(histogram).forEach( ([service, object]) => {
                    percentiles[service] = percentiles[service] || {overall : {percentiles : {}}, per_region: {}, per_pop : {}}

                    // overall percentiles
                    percentiles[service]["overall"]["percentiles"][p] = computePercentileValue(object["overall"]["buckets"], object["overall"]["count"], p)
                    percentiles[service]["overall"]["sum"] = object["overall"]["sum"]
                    percentiles[service]["overall"]["count"] = object["overall"]["count"]

                    // per region percentiles
                    Object.entries(object["per_region"]).forEach( ([region, region_object]) => {
                        percentiles[service]["per_region"][region] =  percentiles[service]["per_region"][region] || { percentiles : {} }
                        percentiles[service]["per_region"][region]["percentiles"][p] = computePercentileValue(region_object["buckets"], region_object["count"], p)
                        percentiles[service]["per_region"][region]["sum"] = region_object["sum"]
                        percentiles[service]["per_region"][region]["count"] = region_object["count"]
                    })

                    // per pop percentiles
                    Object.entries(object["per_pop"]).forEach( ([pop, pop_object]) => {
                        percentiles[service]["per_pop"][pop] =  percentiles[service]["per_pop"][pop] || {percentiles : {}}
                        percentiles[service]["per_pop"][pop]["percentiles"][p] = computePercentileValue(pop_object["buckets"], pop_object["count"], p)
                        percentiles[service]["per_pop"][pop]["sum"] = pop_object["sum"]
                        percentiles[service]["per_pop"][pop]["count"] = pop_object["count"]
                    })
                });

            })

            if (Object.keys(percentiles).length > 0 ) {
                var new_metric_name = metric_name.replace("histogram","summary")
                result.push(`# HELP ${prefix}${new_metric_name}_per_service ${prefix}${new_metric_name}_per_service`)
                result.push(`# TYPE ${prefix}${new_metric_name}_per_service summary`)
                Object.entries(percentiles).forEach( ([service, service_object]) => {
                    // service_object is {overall : {percentiles : {}, sum:, count:}, per_region: {}, per_pop : {}}
                    Object.entries(service_object["overall"]["percentiles"]).forEach( ([p, value]) => {
                        result.push(`${prefix}${new_metric_name}_per_service{quantile="${(1.0*p/100).toFixed(2)}",ser="${service}"} ${value}`);
                    })
                    result.push(`${prefix}${new_metric_name}_per_service_count{ser="${service}"} ${service_object["overall"]["count"]}`);
                    result.push(`${prefix}${new_metric_name}_per_service_sum{ser="${service}"} ${service_object["overall"]["sum"]}`);
                })

                // per region
                result.push(`# HELP ${prefix}${new_metric_name}_per_service_region ${prefix}${new_metric_name}_per_service_region`)
                result.push(`# TYPE ${prefix}${new_metric_name}_per_service_region summary`)
                Object.entries(percentiles).forEach( ([service, service_object]) => {
                    Object.entries(service_object["per_region"]).forEach( ([region, region_object]) => {
                        Object.entries(region_object["percentiles"]).forEach( ([p, value]) => {
                            result.push(`${prefix}${new_metric_name}_per_service_region{quantile="${(1.0*p/100).toFixed(2)}",reg="${region}",ser="${service}"} ${value}`);
                        })
                        result.push(`${prefix}${new_metric_name}_per_service_region_count{reg="${region}",ser="${service}"} ${region_object["count"]}`);
                        result.push(`${prefix}${new_metric_name}_per_service_region_sum{reg="${region}",ser="${service}"} ${region_object["sum"]}`);
                    })
                })

                // per pop
                result.push(`# HELP ${prefix}${new_metric_name}_per_service_pop ${prefix}${new_metric_name}_per_service_pop`)
                result.push(`# TYPE ${prefix}${new_metric_name}_per_service_pop summary`)
                Object.entries(percentiles).forEach( ([service, service_object]) => {
                    Object.entries(service_object["per_pop"]).forEach( ([pop, pop_object]) => {
                        Object.entries(pop_object["percentiles"]).forEach( ([p, value]) => {
                            result.push(`${prefix}${new_metric_name}_per_service_pop{quantile="${(1.0*p/100).toFixed(2)}",pop="${pop}",reg="${pops[pop].region}",ser="${service}"} ${value}`);
                        })
                        result.push(`${prefix}${new_metric_name}_per_service_pop_count{pop="${pop}",reg="${pops[pop].region}",ser="${service}"} ${pop_object["count"]}`);
                        result.push(`${prefix}${new_metric_name}_per_service_pop_sum{pop="${pop}",reg="${pops[pop].region}",ser="${service}"} ${pop_object["sum"]}`);
                    })
                })
            }
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
