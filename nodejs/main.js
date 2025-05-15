"use strict";
const express = require("express");
const argumentParser = require("@edouardbe/command-line-arguments-configuration-file-environment-variables-parser");
const os = require("os");
const fs = require("fs");
const axios = require("axios");
const createLogger = require("./logger");
const executionQueue = new (require("./executionQueue"))();

const definitions = [
  {
    name: "verbose",
    alias: "v",
    type: Boolean,
    defaultIfMissing: false,
    defaultIfPresent: true,
    desc: "activate the verbose mode",
  },
  {
    name: "bypass-initial-test",
    type: Boolean,
    defaultIfMissing: false,
    defaultIfPresent: true,
    desc: "used to bypass the initial test",
  },
  {
    name: "configuration-file",
    type: String,
    desc: "location of the configuration file to read more variables",
  },
  {
    name: "output-dir",
    type: String,
    defaultIfMissing: os.tmpdir(),
    desc: "the output directory where temporary data will be stored",
  },
  {
    name: "output-file",
    type: String,
    defaultIfMissing: "fastly-real-time-api-to-prometheus.data",
    desc: "the output file where temporary data will be stored",
  },
  {
    name: "logs-dir",
    type: String,
    defaultIfMissing: "/var/log",
    dirCreateIfMissing: true,
    desc: "the directory to write the logs",
  },
  {
    name: "logs-file",
    type: String,
    defaultIfMissing: "fastly-real-time-api-to-prometheus.log",
    desc: "the file to write the logs",
  },
  {
    name: "logs-console",
    type: Boolean,
    defaultIfMissing: false,
    defaultIfPresent: true,
    desc: "additionally write the logs in the console too",
  },
  {
    name: "nodejs-port",
    type: "integer",
    defaultIfMissing: 9145,
    required: true,
    desc: "the port to listen to",
  },
  {
    name: "nodejs-path",
    type: String,
    defaultIfMissing: "/metrics",
    required: true,
    desc: "the path to listen to",
  },
  {
    name: "fastly-key",
    type: String,
    obfuscate: true,
    required: true,
    desc: "the Fastly api key to authenticate to Fastly",
  },
  {
    name: "fastly-service-id",
    type: String,
    obfuscate: true,
    desc: "the Fastly service id(s) to get the real-data, csv",
  },
  {
    name: "ignore-metrics",
    type: String,
    desc: "semi-column separated values of metrics to ignore",
  },
  {
    name: "ignore-counter-zero",
    type: Boolean,
    defaultIfMissing: true,
    defaultIfPresent: true,
    desc: "ignore the counter if the value is 0",
  },
  {
    name: "metric-prefix",
    type: String,
    defaultIfMissing: "",
    desc: "add a prefix to all metrics for prometheus",
  },
  {
    name: "background-execution-period",
    type: "integer",
    defaultIfMissing: 120,
    desc: "nb seconds between the background execution if the endpoint is not called",
  },
  {
    name: "miss-latency-percentiles",
    type: String,
    defaultIfMissing: "10,25,50,75,90,95",
    desc: "list of the percentiles to compute for the miss latency. Put an empty string if you don't want the percentiles to be computed",
  },
  {
    name: "miss-latency-histograms",
    type: Boolean,
    defaultIfMissing: true,
    desc: "enable/disable to add the miss latency buckets",
  },
];

const options = {
  envVarPrefix: "FRTATP_",
  cfgFileArg: "configuration-file",
};

const parsedArguments = argumentParser(definitions, options);
const logger = createLogger(parsedArguments.get("logs-file"), parsedArguments.get("logs-dir"), parsedArguments.get("verbose") == true ? "debug" : "info", parsedArguments.get("logs-console"));

logger.info(`Start at ${new Date()}`);

parsedArguments.getValuesAndSource().forEach((o) => {
  logger.info(`option ${o.name} is ${o.value} from ${o.from}`);
});

const axiosInstance = axios.create({
  headers: {
    Accept: "application/json",
    "Fastly-Key": parsedArguments.get("fastly-key").replace(/^"/, "").replace(/"$/, ""),
  },
});

// Call Fastly API to retrieve all the services associated to the account (Fastly key)
// return [{id: ,name: ,version:}]
function getAllFastlyServicesPromise() {
  const start = Date.now();
  return axiosInstance
    .get("https://api.fastly.com/service", {
      params: { page: 1, per_page: 200 },
    })
    .then((res) =>
      res.data.map((d) => {
        return { id: d.id, name: d.name, version: d.version };
      })
    )
    .finally(() => {
      logger.debug(`Execution time to retrieve the Fastly Services from API: ${Date.now() - start} ms`);
    });
}

// Filter the services with only those specified in the arguments (if some are specified)
function filterServices(services) {
  var specifiedServiceIds = parsedArguments.get("fastly-service-id");
  if (specifiedServiceIds != null && specifiedServiceIds != "") {
    services = services.filter((s) => specifiedServiceIds.indexOf(s.id) > -1);
  }
  return services;
}

// Call the Fastly real-time API with a service and timestamp to retrieve the real-time data
// Need the last recorded timestamp, or "h" is missing, "h" is from Fastly API doc.
function getRealTimeMetricsPromise(service, timestamp) {
  const start = Date.now();
  timestamp = timestamp || "h";
  return axiosInstance
    .get(`https://rt.fastly.com/v1/channel/${service.id}/ts/${timestamp}`)
    .then((res) => res.data.Data)
    .finally(() => {
      logger.debug(`Execution time to retrieve the Fastly Real Time Data for Service ${service.id} from API: ${Date.now() - start} ms`);
    });
}

// Call the Fastly API to retrieve all the PoPs
// return an object { "ABC : { region: }"}
function getAllFastlyPoPsPromise() {
  const start = Date.now();
  return axiosInstance
    .get("https://api.fastly.com/datacenters")
    .then((res) =>
      res.data.reduce((acc, p) => {
        acc[p.code] = { region: p.billing_region };
        return acc;
      }, {})
    )
    .finally(() => {
      logger.debug(`Execution time to retrieve the Fastly PoPs from API: ${Date.now() - start} ms`);
    });
}

// Load the previous data from a file
// Reset the file if the day change, at midnight
function loadPreviousDataPromise(filepath) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    if (fs.existsSync(filepath)) {
      fs.readFile(filepath, (err, data) => {
        if (err) {
          reject(err);
        } else {
          if (data != "") {
            var obj = JSON.parse(data);

            if (obj.timestamp < new Date().setHours(0, 0, 0, 0)) {
              logger.debug("erasing previous counter");
              resolve({});
            } else {
              resolve(obj);
            }
          } else {
            resolve({});
          }
        }
      });
    } else {
      resolve({});
    }
  }).finally(() => {
    logger.debug(`Execution time to load the previous data from file: ${Date.now() - start} ms`);
  });
}

// Save the data to a file
// When foregound, need to reset the histograms for the next calls, as they are not counters
function saveDataToFilePromise(filepath, array, isBackgroundCall) {
  var obj = {};
  obj.timestamp = new Date();
  obj.previousData = JSON.parse(JSON.stringify(array));
  if (isBackgroundCall == false) {
    obj.previousData.forEach((serviceObject) => {
      Object.values(serviceObject.datacenter).forEach((pop) => {
        delete pop.miss_histogram;
      });
    });
  }
  return new Promise((resolve, reject) => {
    fs.writeFile(filepath, JSON.stringify(obj), (err) => (err ? reject(err) : resolve()));
  });
}

// Merge the previous and new data
function mergeData(previousData, newData) {
  const start = Date.now();
  logger.debug("previousData :", previousData);
  logger.debug("newData :", newData);

  // reduce the metrics
  var mergedData = newData.reduce((acc, cur) => {
    Object.entries(cur.datacenter).forEach(([datacenter, metrics]) => {
      acc.datacenter[datacenter] = acc.datacenter[datacenter] || {};
      Object.entries(metrics).forEach(([key, value]) => {
        if (
          parsedArguments.get("ignore-metrics") == null ||
          parsedArguments
            .get("ignore-metrics")
            .split(";")
            .find((m) => key.indexOf(m) > -1) == null
        ) {
          if (key.indexOf("histogram") > -1) {
            logger.debug("histogram key :", key);
            logger.debug("histogram value :", value);
            acc.datacenter[datacenter][key] = acc.datacenter[datacenter][key] || {};
            Object.entries(value).forEach(([bucketKey, bucketValue]) => {
              acc.datacenter[datacenter][key][bucketKey] = (acc.datacenter[datacenter][key][bucketKey] || 0) + bucketValue;
            });
          } else {
            acc.datacenter[datacenter][key] = (acc.datacenter[datacenter][key] || 0) + value;
          }
        }
      });
    });
    acc.recorded = Math.max(cur.recorded, acc.recorded || 0);
    return acc;
  }, previousData || { datacenter: {} });

  logger.debug("mergedData :", mergedData);
  logger.debug(`Execution time to merge the data: ${Date.now() - start} ms`);
  return mergedData;
}

// Compute the percentile value from buckets, the number of items and the requested percentile
// Fastly Buckets are specific to Fastly.
function computePercentileValue(buckets, count, percentile) {
  // Compute the index
  var index = parseInt((count * percentile) / 100);
  // Convert keys to numbers and sort them
  var sortedBucketKeys = Object.keys(buckets).sort((a, b) => a - b);
  // Iterate to find the right bucket and span
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

      // Calculate the weighted average in the bucket
      return Math.round(minValue + (index * (maxValue - minValue)) / buckets[key]);
    }
    // Decrement the index by the value for this key
    index -= buckets[key];
  }

  // Return null if no key is found (index out of range)
  return null;
}

// Tranform the Json objects into the Prometheus format
function json2prometheus(mergedDataArray, pops, services) {
  const start = Date.now();
  var result = [];
  // Get the prefix specified in the arguments
  var prefix = parsedArguments.get("metric-prefix");

  // add the services and their info for dependency in grafana
  result.push(`# HELP ${prefix}services ${prefix}services`);
  result.push(`# TYPE ${prefix}services gauge`);
  services.forEach((s) => result.push(`${prefix}services{ser="${s.id}",name="${s.name}",version="${s.version}"} 1`));

  // add the datacenters (renamed pop ) and their regions for dependency in grafana
  result.push(`# HELP ${prefix}pops ${prefix}pops`);
  result.push(`# TYPE ${prefix}pops gauge`);
  Object.entries(pops).forEach(([k, v]) => {
    result.push(`${prefix}pops{pop="${k}",reg="${v.region}"} 1`);
  });

  // need to transform the mergedDataArray [{ "recorded" : 123 , "datacenter" :{ "ABC"" : { metrics }}}] into { metric : [{service:, pop: , value: }]}}
  var translatedMetrics = {};
  // for each service
  mergedDataArray.forEach((mergedDataItem) => {
    // for each pop
    Object.entries(mergedDataItem.datacenter).forEach(([datacenter, metrics]) => {
      // for each metric
      Object.entries(metrics).forEach(([key, value]) => {
        translatedMetrics[key] = translatedMetrics[key] || [];
        translatedMetrics[key].push({
          service: mergedDataItem.service,
          pop: datacenter,
          value: value,
        });
      });
    });
  });
  logger.debug("translatedMetrics:", translatedMetrics);

  // All the status_XXX will be handled in a status object
  var status = {};
  // All the tls_XXX will be handled in a tls object
  var tls = {};
  // All the object_size_XXX will be handled in a object_size object
  var objectSize = {};

  // for each metrics
  Object.entries(translatedMetrics).forEach(([metricName, values]) => {
    // values is [{service:, pop: , value: }]

    // for miss histogram
    if (metricName == "miss_histogram") {
      // The missHistogram object will be used for the prometheus histograms and summary (percentiles)
      var missHistogram = {};
      values.forEach((v) => {
        logger.debug("v :", v);

        missHistogram[v.service] = missHistogram[v.service] || {
          overall: { buckets: {}, count: 0, sum: 0 },
          pops: {},
          regions: {},
        };
        missHistogram[v.service]["regions"][pops[v.pop].region] = missHistogram[v.service]["regions"][pops[v.pop].region] || {
          buckets: {},
          count: 0,
          sum: 0,
        };
        missHistogram[v.service]["pops"][v.pop] = missHistogram[v.service]["pops"][v.pop] || { buckets: {}, count: 0, sum: 0 };

        Object.entries(v.value).forEach(([bucketKey, bucketValue]) => {
          var bucketInt = parseInt(bucketKey);
          missHistogram[v.service]["overall"]["buckets"][bucketInt] = (missHistogram[v.service]["overall"]["buckets"][bucketInt] || 0) + bucketValue;
          missHistogram[v.service]["overall"]["count"] += bucketValue;
          missHistogram[v.service]["overall"]["sum"] += bucketValue * bucketInt;

          missHistogram[v.service]["regions"][pops[v.pop].region]["buckets"][bucketInt] = (missHistogram[v.service]["regions"][pops[v.pop].region]["buckets"][bucketInt] || 0) + bucketValue;
          missHistogram[v.service]["regions"][pops[v.pop].region]["count"] += bucketValue;
          missHistogram[v.service]["regions"][pops[v.pop].region]["sum"] += bucketValue * bucketInt;

          missHistogram[v.service]["pops"][v.pop]["buckets"][bucketInt] = (missHistogram[v.service]["pops"][v.pop]["buckets"][bucketInt] || 0) + bucketValue;
          missHistogram[v.service]["pops"][v.pop]["count"] += bucketValue;
          missHistogram[v.service]["pops"][v.pop]["sum"] += bucketValue * bucketInt;
        });
      });
      logger.debug("histogram :", missHistogram);

      if (parsedArguments.get("miss-latency-histograms") == true) {
        // Miss latency histogram at the Service level
        var tempResult = [];
        Object.entries(missHistogram).forEach(([service, serviceObject]) => {
          var sortedBucketKeys = Object.keys(serviceObject["overall"]["buckets"]).sort((a, b) => a - b);
          var acc = 0;
          for (let key of sortedBucketKeys) {
            acc += serviceObject["overall"]["buckets"][key];
            tempResult.push(`${prefix}${metricName}_per_service_bucket{ser="${service}",le="${key}"} ${acc}`);
          }
          tempResult.push(`${prefix}${metricName}_per_service_bucket{ser="${service}",le="+Inf"} ${acc}`);
          tempResult.push(`${prefix}${metricName}_per_service_count{ser="${service}"} ${serviceObject["overall"]["count"]}`);
          tempResult.push(`${prefix}${metricName}_per_service_sum{ser="${service}"} ${serviceObject["overall"]["sum"]}`);
        });
        if (tempResult.length > 0) {
          result.push(`# HELP ${prefix}${metricName}_per_service ${prefix}${metricName}_per_service`);
          result.push(`# TYPE ${prefix}${metricName}_per_service histogram`);
          result = result.concat(tempResult);
        }

        // Miss latency histogram at the Service + Region level
        tempResult = [];
        Object.entries(missHistogram).forEach(([service, serviceObject]) => {
          Object.entries(serviceObject["regions"]).forEach(([region, regionObject]) => {
            var sortedBucketKeys = Object.keys(regionObject["buckets"]).sort((a, b) => a - b);
            var acc = 0;
            for (let key of sortedBucketKeys) {
              acc += regionObject["buckets"][key];
              tempResult.push(`${prefix}${metricName}_per_service_region_bucket{reg="${region}",ser="${service}",le="${key}"} ${acc}`);
            }
            tempResult.push(`${prefix}${metricName}_per_service_region_bucket{reg="${region}",ser="${service}",le="+Inf"} ${acc}`);
            tempResult.push(`${prefix}${metricName}_per_service_region_count{reg="${region}",ser="${service}"} ${regionObject["count"]}`);
            tempResult.push(`${prefix}${metricName}_per_service_region_sum{reg="${region}",ser="${service}"} ${regionObject["sum"]}`);
          });
        });
        if (tempResult.length > 0) {
          result.push(`# HELP ${prefix}${metricName}_per_service_region ${prefix}${metricName}_per_service_region`);
          result.push(`# TYPE ${prefix}${metricName}_per_service_region histogram`);
          result = result.concat(tempResult);
        }

        // Miss latency histogram at the Service + PoP level
        tempResult = [];
        Object.entries(missHistogram).forEach(([service, serviceObject]) => {
          Object.entries(serviceObject["pops"]).forEach(([pop, popObject]) => {
            var sortedBucketKeys = Object.keys(popObject["buckets"]).sort((a, b) => a - b);
            var acc = 0;
            var region = pops[pop].region;
            for (let key of sortedBucketKeys) {
              acc += popObject["buckets"][key];
              tempResult.push(`${prefix}${metricName}_per_service_pop_bucket{pop="${pop}",reg="${region}",ser="${service}",le="${key}"} ${acc}`);
            }
            tempResult.push(`${prefix}${metricName}_per_service_pop_bucket{pop="${pop}",reg="${region}",ser="${service}",le="+Inf"} ${acc}`);
            tempResult.push(`${prefix}${metricName}_per_service_pop_count{pop="${pop}",reg="${region}",ser="${service}"} ${popObject["count"]}`);
            tempResult.push(`${prefix}${metricName}_per_service_pop_sum{pop="${pop}",reg="${region}",ser="${service}"} ${popObject["sum"]}`);
          });
        });
        if (tempResult.length > 0) {
          result.push(`# HELP ${prefix}${metricName}_per_service_pop ${prefix}${metricName}_per_service_pop`);
          result.push(`# TYPE ${prefix}${metricName}_per_service_pop histogram`);
          result = result.concat(tempResult);
        }
      }

      // compute the percentiles from the histograms
      var percentiles = {};
      if (parsedArguments.get("miss-latency-percentiles") != null) {
        parsedArguments
          .get("miss-latency-percentiles")
          .split(",")
          .flat()
          .map(Number)
          .forEach((p) => {
            // per service
            Object.entries(missHistogram).forEach(([service, object]) => {
              percentiles[service] = percentiles[service] || {
                overall: { percentiles: {} },
                regions: {},
                pops: {},
              };

              // overall percentiles
              percentiles[service]["overall"]["percentiles"][p] = computePercentileValue(object["overall"]["buckets"], object["overall"]["count"], p);
              percentiles[service]["overall"]["sum"] = object["overall"]["sum"];
              percentiles[service]["overall"]["count"] = object["overall"]["count"];

              // per region percentiles
              Object.entries(object["regions"]).forEach(([region, regionObject]) => {
                percentiles[service]["regions"][region] = percentiles[service]["regions"][region] || { percentiles: {} };
                percentiles[service]["regions"][region]["percentiles"][p] = computePercentileValue(regionObject["buckets"], regionObject["count"], p);
                percentiles[service]["regions"][region]["sum"] = regionObject["sum"];
                percentiles[service]["regions"][region]["count"] = regionObject["count"];
              });

              // per pop percentiles
              Object.entries(object["pops"]).forEach(([pop, popObject]) => {
                percentiles[service]["pops"][pop] = percentiles[service]["pops"][pop] || { percentiles: {} };
                percentiles[service]["pops"][pop]["percentiles"][p] = computePercentileValue(popObject["buckets"], popObject["count"], p);
                percentiles[service]["pops"][pop]["sum"] = popObject["sum"];
                percentiles[service]["pops"][pop]["count"] = popObject["count"];
              });
            });
          });
      }

      if (Object.keys(percentiles).length > 0) {
        // Change the name of the metric
        var newMetricName = metricName.replace("histogram", "summary");

        // Miss Latency summary per Service
        result.push(`# HELP ${prefix}${newMetricName}_per_service ${prefix}${newMetricName}_per_service`);
        result.push(`# TYPE ${prefix}${newMetricName}_per_service summary`);
        Object.entries(percentiles).forEach(([service, serviceObject]) => {
          Object.entries(serviceObject["overall"]["percentiles"]).forEach(([p, value]) => {
            result.push(`${prefix}${newMetricName}_per_service{quantile="${((1.0 * p) / 100).toFixed(2)}",ser="${service}"} ${value}`);
          });
          result.push(`${prefix}${newMetricName}_per_service_count{ser="${service}"} ${serviceObject["overall"]["count"]}`);
          result.push(`${prefix}${newMetricName}_per_service_sum{ser="${service}"} ${serviceObject["overall"]["sum"]}`);
        });

        // Miss Latency summary per Service + Region
        result.push(`# HELP ${prefix}${newMetricName}_per_service_region ${prefix}${newMetricName}_per_service_region`);
        result.push(`# TYPE ${prefix}${newMetricName}_per_service_region summary`);
        Object.entries(percentiles).forEach(([service, serviceObject]) => {
          Object.entries(serviceObject["regions"]).forEach(([region, regionObject]) => {
            Object.entries(regionObject["percentiles"]).forEach(([p, value]) => {
              result.push(`${prefix}${newMetricName}_per_service_region{quantile="${((1.0 * p) / 100).toFixed(2)}",reg="${region}",ser="${service}"} ${value}`);
            });
            result.push(`${prefix}${newMetricName}_per_service_region_count{reg="${region}",ser="${service}"} ${regionObject["count"]}`);
            result.push(`${prefix}${newMetricName}_per_service_region_sum{reg="${region}",ser="${service}"} ${regionObject["sum"]}`);
          });
        });

        // Miss Latency summary per Service + PoP
        result.push(`# HELP ${prefix}${newMetricName}_per_service_pop ${prefix}${newMetricName}_per_service_pop`);
        result.push(`# TYPE ${prefix}${newMetricName}_per_service_pop summary`);
        Object.entries(percentiles).forEach(([service, serviceObject]) => {
          Object.entries(serviceObject["pops"]).forEach(([pop, popObject]) => {
            Object.entries(popObject["percentiles"]).forEach(([p, value]) => {
              result.push(`${prefix}${newMetricName}_per_service_pop{quantile="${((1.0 * p) / 100).toFixed(2)}",pop="${pop}",reg="${pops[pop].region}",ser="${service}"} ${value}`);
            });
            result.push(`${prefix}${newMetricName}_per_service_pop_count{pop="${pop}",reg="${pops[pop].region}",ser="${service}"} ${popObject["count"]}`);
            result.push(`${prefix}${newMetricName}_per_service_pop_sum{pop="${pop}",reg="${pops[pop].region}",ser="${service}"} ${popObject["sum"]}`);
          });
        });
      }
    } else if (metricName.indexOf("status_") == 0) {
      var code = metricName.substring("status_".length);
      values.forEach((v) => {
        status[v.service] = status[v.service] || {};
        status[v.service][v.pop] = status[v.service][v.pop] || {};
        status[v.service][v.pop][code] = v.value;
      });
    } else if (metricName.indexOf("object_size_") == 0) {
      var size = metricName.substring("object_size_".length);
      values.forEach((v) => {
        objectSize[v.service] = objectSize[v.service] || {};
        objectSize[v.service][v.pop] = objectSize[v.service][v.pop] || {};
        objectSize[v.service][v.pop][size] = v.value;
      });
    } else if (metricName.indexOf("tls_") == 0) {
      var code = metricName.substring("tls_".length);
      values.forEach((v) => {
        tls[v.service] = tls[v.service] || {};
        tls[v.service][v.pop] = tls[v.service][v.pop] || {};
        tls[v.service][v.pop][code] = v.value;
      });
    } else if (metricName == "tls") {
      var code = "XXX";
      values.forEach((v) => {
        tls[v.service] = tls[v.service] || {};
        tls[v.service][v.pop] = tls[v.service][v.pop] || {};
        tls[v.service][v.pop][code] = v.value;
      });
    } else {
      var tempResult = [];
      values.forEach((v) => {
        if (v.value != 0 || parsedArguments.get("ignore-counter-zero") == false) {
          tempResult.push(`${prefix}${metricName}{pop="${v.pop}",reg="${pops[v.pop].region}",ser="${v.service}"} ${v.value}`);
        }
      });

      if (tempResult.length > 0) {
        result.push(`# HELP ${prefix}${metricName} ${prefix}${metricName}`);
        result.push(`# TYPE ${prefix}${metricName} counter`);
        result = result.concat(tempResult);
      }
    }
  });

  // Status
  if (Object.entries(status).length != 0) {
    result.push(`# HELP ${prefix}status ${prefix}status`);
    result.push(`# TYPE ${prefix}status counter`);
    Object.entries(status).forEach(([service, s_pops]) => {
      Object.entries(s_pops).forEach(([pop, values]) => {
        Object.entries(values).forEach(([code, value]) => {
          result.push(`${prefix}status{pop="${pop}",reg="${pops[pop].region}",ser="${service}",code="${code}"} ${value}`);
        });
      });
    });
  }

  // Obejct Size
  if (Object.entries(objectSize).length != 0) {
    result.push(`# HELP ${prefix}object_size ${prefix}object_size`);
    result.push(`# TYPE ${prefix}object_size counter`);
    Object.entries(objectSize).forEach(([service, s_pops]) => {
      Object.entries(s_pops).forEach(([pop, values]) => {
        Object.entries(values).forEach(([size, value]) => {
          result.push(`${prefix}object_size{pop="${pop}",reg="${pops[pop].region}",ser="${service}",size="${size}"} ${value}`);
        });
      });
    });
  }

  // TLS
  if (Object.entries(tls).length != 0) {
    result.push(`# HELP ${prefix}tls ${prefix}tls`);
    result.push(`# TYPE ${prefix}tls counter`);
    Object.entries(tls).forEach(([service, s_pops]) => {
      Object.entries(s_pops).forEach(([pop, values]) => {
        Object.entries(values).forEach(([version, value]) => {
          result.push(`${prefix}tls{pop="${pop}",reg="${pops[pop].region}",ser="${service}",version="${version}"} ${value}`);
        });
      });
    });
  }

  // Timestamp
  result.push(`# HELP ${prefix}last_timestamp ${prefix}last_timestamp`);
  result.push(`# TYPE l${prefix}ast_timestamp counter`);
  mergedDataArray.forEach((service) => {
    if (service.recorded) {
      result.push(`${prefix}last_timestamp{ser="${service.service}"} ${service.recorded}`);
    }
  });

  logger.debug(`Execution time to prepare the prometheus data: ${Date.now() - start} ms`);
  return result.join("\n");
}

// Do the job
// Calls different Fastly API endpoints to get the Datacenters, the Services, the New Data.
// Load the previeus Data from a file
// Merge
// Transform the new Data into a Prometheus format
// Save the new Data into file, with reseting the histograms on foreground calls.
function mainPromise(filepath, isBackgroundCall) {
  const start = new Date();

  return Promise.all([
    getAllFastlyPoPsPromise(), // Retrieve all Datacenters from Fastly API
    loadPreviousDataPromise(filepath), // Load the previous Data from file
    getAllFastlyServicesPromise().then((services) => filterServices(services)), // Retrieve and Filter the Services from Fastly API
  ])
    .then(([pops, previousDataObj, services]) =>
      Promise.all(
        // For each service, merge the previous and new data
        services.map((service) => {
          // Get the preview data for the service
          var previousData = (previousDataObj.previousData || []).find((p) => p.service == service.id);
          // Get the last recorded timepstamp
          var timestamp = (previousData || {})["recorded"];
          // Get the new Real time data for the service
          return getRealTimeMetricsPromise(service, timestamp).then((newData) => {
            // Merge the previous data with the new data
            var mergedData = mergeData(previousData, newData);
            // Add the service id
            mergedData.service = service.id;
            return mergedData;
          });
        })
      ).then((mergedDataArray) =>
        Promise.all([
          saveDataToFilePromise(filepath, mergedDataArray, isBackgroundCall), // Save the merged data into file
          json2prometheus(mergedDataArray, pops, services), // Transform the json into prometheus data
        ])
      )
    )
    .then(
      (
        [_, prometheusData] // Return only the prometheusData
      ) => prometheusData
    )
    .finally(() => {
      logger.debug(`execution time to call mainPromise in ${isBackgroundCall ? "backgound" : "foreground"}: ${Date.now() - start} ms`);
    });
}

// Create a timer for the background calls
var executionTimer = null;

function execute(filepath, isBackgroundCall, isDryRunCall = false) {
  if (executionTimer != null) {
    clearTimeout(executionTimer);
  }

  return executionQueue.push(() =>
    mainPromise(filepath, isBackgroundCall).finally(() => {
      if (executionTimer != null) {
        clearTimeout(executionTimer);
      }
      var delay = parsedArguments.get("background-execution-period");
      if (delay > 0 && isDryRunCall == false) {
        executionTimer = setTimeout(() => {
          execute(`${parsedArguments.get("output-dir")}/${parsedArguments.get("output-file")}`, true);
        }, delay * 1000);
      }
    })
  );
}

// Delete previous data file if exist
function delelePreviousData() {
  var path = `${parsedArguments.get("output-dir")}/${parsedArguments.get("output-file")}`;
  logger.debug("file", path, "exist?", fs.existsSync(path));
  if (fs.existsSync(path)) {
    logger.info("delete file", path);
    fs.unlinkSync(path);
  }
}

// Display a message when the app is ready
function ready() {
  logger.info(`Listening now on port ${parsedArguments.get("nodejs-port")} and path ${parsedArguments.get("nodejs-path")}`);
}

// Create the app
const app = express();

// Create the Endpoint to get the metrics  (/metrics)
// ?background=true if you want to force the background mode
app.get(parsedArguments.get("nodejs-path"), (req, res) => {
  const background = req.query.background;
  logger.debug("req.query :", req.query);
  execute(`${parsedArguments.get("output-dir")}/${parsedArguments.get("output-file")}`, background == "true")
    .then((data) => {
      res.status(200).send(data);
    })
    .catch((error) => {
      logger.error(error);
      res.status(500).send(error);
    });
});

// Create the Endpoint to get delete the file storing the data
app.get("/clean", (req, res) => {
  delelePreviousData();
  return res.status(200).end();
});

// At startup, delete the previous data
delelePreviousData();

// In test mode (mocha tests), don't do the initial test and don't start listening on port.
if (process.env.NODE_ENV !== "test") {
  if (parsedArguments.get("bypass-initial-test") == false) {
    // Some checks, try to run the script
    logger.info("Execute a dry run call as an initial test");
    var testFilePath = os.tmpdir() + parseInt(Math.random() * Number.MAX_SAFE_INTEGER);

    execute(testFilePath, false, true)
      .then((data) => {
        fs.unlink(testFilePath, (err) => {
          if (err != null) {
            logger.error(err);
          }
        });
        app.listen(parsedArguments.get("nodejs-port"), () => {
          logger.debug(data);
          logger.info("Dry run ok");
          ready();
        });
      })
      .catch((error) => {
        logger.error(error);
        throw error;
      });
  } else {
    app.listen(parsedArguments.get("nodejs-port"), () => {
      logger.info("Bypass initial test, no dry run");
      ready();
    });
  }
}

module.exports = app;
