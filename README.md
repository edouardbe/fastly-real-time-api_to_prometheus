# Fastly Real-time API to Prometheus

The project aims to call the Fastly Real-time API and transform the data into a format for Proemetheus, with counters and histograms.

## Fastly Real-time API doc
See https://developer.fastly.com/reference/api/metrics-stats/realtime/

## Minimum requirement
The Fastly Real-time API needs a *Fastly Api Key* and a *Service Id* to run properly. It's recommended to use either a configuration file or to set environment variables.
The other variables are optional

Sample configuration file
```
# set your Fastly API key here or by environment variable. Required
FRTATP_FASTLY_KEY=ABC
# set your Fastly Service ID here or by environment variable. Required
FRTATP_FASTLY_SERVICE_ID=DEF
# set the directory where to write the data for prometheus. Optional. current directory will be used by default
#FRTATP_OUTPUT_DIR=.
# set the filenmae where to write the data for prometheus. Optional. fastly-real-time-api-to-prometheus.data will be used by default
#FRTATP_OUTPUT_FILE="fastly-real-time-api-to-prometheus.data"
# set the list of metrics to ignore from Fastly real-time api, if you are not interested by them. Optional.
FRTATP_IGNORE_METRICS="attack_;compute_;fanout_;imgopto;imgvideo;log;otfp;waf;websocket;billed;deliver_sub;error_;fetch_;hash_sub_;hit_sub_;object_size;pass_sub;predeliver_sub;prehash_sub;recv_sub;synth;video"
```

For environment variables, use the same keys
```
FRTATP_FASTLY_KEY
FRTATP_FASTLY_SERVICE_ID
FRTATP_OUTPUT_DIR
FRTATP_OUTPUT_FILE
FRTATP_IGNORE_METRICS
```

Note that 
- the environement variables are overidden by the values in the configuation file
- the values in the configuration file are overidden by the arguments in the command line

## Quick note on the Real-time API
The Fastly Real-time API 'https://rt.fastly.com/v1/channel/${FRTATP_FASTLY_SERVICE_ID}/ts/h' returns the last 120s data, with an object per second, and sub-object for each pop. 

## Frequency to call the script
It's recommended to call the script every 2 minutes or less, else you will loose data. If the script is called every less than 2 minutes, the seconds already treated from the previous call will be ignored.


## Fastly PoPs and regions
The script will also fetch the Fastly PoPs and their Regions. Regions names are replaced by 2 letters codes (SA,EU,AF...)

PoPs and their regions are added in the data for Prometheus, for you to create variables PoPs and Regions in Grafana, and a dependency between them
```
# HELP pops pops
# TYPE pops gauge
pops{pop="MIA",reg="US"} 1
pops{pop="HKG",reg="AP"} 1
pops{pop="DEN",reg="US"} 1
pops{pop="VIE",reg="EU"} 1
```

## Fastly last timestamp ingested
The last timestamp read from the real-time API is also saved in the data for Prometheus. You could check the regulatity of the fetch over the time.
```
# HELP last_timestamp last_timestamp
# TYPE last_timestamp counter
last_timestamp 1666604041
```

## Counters for Prometheus
The new data are computed and added to the previous data as counters with the PoP and Region labels
```
# HELP edge_miss_resp_body_bytes edge_miss_resp_body_bytes
# TYPE edge_miss_resp_body_bytes counter
edge_miss_resp_body_bytes{pop="HKG",reg="AP"} 26218152
edge_miss_resp_body_bytes{pop="MIA",reg="US"} 895050700
edge_miss_resp_body_bytes{pop="DEN",reg="US"} 4896
edge_miss_resp_body_bytes{pop="ITM",reg="AP"} 9486
```

## Reset counter
Prometheus Increase and Rate functions are able to manage counters down to zero.
- At Midnight, the counters are reset, to avoid too high numbers.
- if the file with the previous computed data can not be found, counters are reset. 

## Histograms for MISS latency
For the MISS latency, Histograms are used. To have Prometheus/Grafana working properly, all the buckets have to be specified for all PoPs/Regions, and the sum and count. For the histogram, we are dependent of the buckets defined by Fastly
```
# HELP miss_histogram miss_histogram
# TYPE miss_histogram histogram
miss_histogram_bucket{pop="HKG",reg="AP",le="40"} 6
miss_histogram_bucket{pop="HKG",reg="AP",le="50"} 7
miss_histogram_bucket{pop="HKG",reg="AP",le="60"} 7
miss_histogram_bucket{pop="HKG",reg="AP",le="70"} 7
miss_histogram_bucket{pop="HKG",reg="AP",le="80"} 7
miss_histogram_bucket{pop="HKG",reg="AP",le="90"} 7
miss_histogram_bucket{pop="HKG",reg="AP",le="100"} 7
miss_histogram_bucket{pop="HKG",reg="AP",le="110"} 10
miss_histogram_bucket{pop="HKG",reg="AP",le="120"} 13
miss_histogram_bucket{pop="HKG",reg="AP",le="130"} 13
miss_histogram_bucket{pop="HKG",reg="AP",le="140"} 14
miss_histogram_bucket{pop="HKG",reg="AP",le="150"} 17
miss_histogram_bucket{pop="HKG",reg="AP",le="160"} 18
miss_histogram_bucket{pop="HKG",reg="AP",le="170"} 18
miss_histogram_bucket{pop="HKG",reg="AP",le="180"} 20
...
miss_histogram_bucket{pop="HKG",reg="AP",le="13000"} 20
miss_histogram_bucket{pop="HKG",reg="AP",le="+Inf"} 20
miss_histogram_sum{pop="HKG",reg="AP"} 2090
miss_histogram_count{pop="HKG",reg="AP"} 20
```

## Ignore metrics that you don't need
The Fastly Real-time API returns a lot of metrics you may not be interested in. You can list the metrics patterns to ignore with a semi-column separated value list, with the beginning of the metrics name to ignore
ie.
```
FRTATP_IGNORE_METRICS="attack_;compute_;fanout_;imgopto;imgvideo;log;otfp;waf;websocket;billed;deliver_sub;error_;fetch_;hash_sub_;hit_sub_;object_size;pass_sub;predeliver_sub;prehash_sub;recv_sub;synth;video"
```

## Cron vs Nodejs
The Cron version will call the script at the specified cron. You will still need a webserver to serve the output file to Prometheus server

The Nodejs express version will turn on a server listening to the port and path you specify, and run the script when Prometheus server calls the endpoint. It seems a better option.

## Next steps
