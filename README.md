# Fastly Real-time API to Prometheus

The project aims to call the Fastly Real-time API and transform the data into a format for Prometheus, with counters and histograms.

Initially, the transformation was done by a bash script using gawk, and a cron to call the script every minute. But it required a local HTTP server like Apache2 to render the file to Prometheus server. The bash script has been removed, and all the transformation is done in a nodejs script.

First evolution had been to
- add a NodeJS Express server that listen to a port (9145) and path (metrics)to call the bash script and transform Fastly Real-time data into Prometheus data.
- create a service to start/status/stop
- add a Makefile to generate a Debian Package.

Second evlution had been to
- remove the bash script, add do all the transformation in the nodejs script
- add the multi-service support, instead of using one server per Fastly service
- transform the Fastly status_XXX into counters status{code="XXX"}
- add Docker to build the image on the nodejs script
- add Docker Compose to have a dev environment with a Prometheus instance (localhost:9090) and a Grafana instance (localhost:3000)
- add a sample Grafana Datasource and Dashboard 

## Fastly Real-time API doc
See https://developer.fastly.com/reference/api/metrics-stats/realtime/

## Minimum requirement
The Fastly Real-time API needs a *Fastly Api Key* to run properly. It's recommended to put the variables into a configuration file 
Set environment variables would work.
The other variables are optional

## Configuration
see sample_config.txt

For environment variables, use the same keys as in the configuration file
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

Note the equivalence between the Environment Variable Names and the Command Line Argument Names:
FRTATP_FASTLY_KEY <=> --fastly-key
FRTATP_IGNORE_METRICS <=> --ignore-metrics
...


## Quick note on the Real-time API
The Fastly Real-time API 'https://rt.fastly.com/v1/channel/${FRTATP_FASTLY_SERVICE_ID}/ts/h' returns the last 120s data, with an object per second, and sub-object for each pop. 

## Frequency to call the script
It's recommended to call the nodejs /metrics endpoint every 1 minute.
If you decide to run it less than every 3 minutes, you may loose data, as Fastly Real-time API will return only the last 3 minutes.
To avoid missing data, the nodejs script has a timer to call the Fastly Real-time API every 2 minutes. No worries on the concurrent requests, the script manages it and will ignore the Real-Time data already fetched.
 
## Fastly Services
The script is able to call the services API to retrieve the list of services under the account linked to the fastly key
If you specify some services ids in conf, the script will filter to use only the ones given if they exist.

Service ids, name and version are added in the data for Prometheus, for you to create variables Services in Grafana, and a dependency between them
```
# HELP services services
# TYPE services gauge
services{ser="ABC",name="service-1", version="32"} 1
services{ser="DEF",name="service-2", version="14"} 1
``````


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
last_timestamp{ser="ABC"} 1666604041
```

## Fastly status
```
status{pop="PMO",reg="Europe",ser="ABC",code="200"} 47
status{pop="PMO",reg="Europe",ser="ABC",code="204"} 44
status{pop="PMO",reg="Europe",ser="ABC",code="304"} 2
status{pop="PMO",reg="Europe",ser="ABC",code="4xx"} 24

```
## Counters for Prometheus
The new data are computed and added to the previous data as counters with the PoP, Region, Service ID labels
```
# HELP edge_miss_resp_body_bytes edge_miss_resp_body_bytes
# TYPE edge_miss_resp_body_bytes counter
edge_miss_resp_body_bytes{pop="HKG",reg="AP",ser="ABC"} 26218152
edge_miss_resp_body_bytes{pop="MIA",reg="US",ser="ABC"} 895050700
edge_miss_resp_body_bytes{pop="DEN",reg="US",ser="ABC"} 4896
edge_miss_resp_body_bytes{pop="ITM",reg="AP",ser="ABC"} 9486
```

## Reset counter
Prometheus Increase and Rate functions are able to manage counters down to zero.
- At Midnight, the counters are reset, to avoid too high numbers.
- if the file with the previous computed data can not be found, counters are reset. 


## Summary (Percentiles/Quantiles) for MISS latency
Fastly Real-time API provides buckets, with different spans. Depending of the bucket, the span is different
]1;10] then span = 1
]10;250] then span = 10
]250;1000] then span = 50
]1000; +inf] then span = 100
Each key represents the upper bound of a span.
Based on this description, the exporter can build the percentiles (integer values like 10 for 10th percentile).
To avoid using only the upper bound of the span, if the requested percentile is in a bucket, like the bucket key 250, meaning ]240,250] with 20 requests in the bucket, the percentile will be computed using steps of the span divided by the number of requests in the bucket, ie, steps of (250-240)/20 = 0.5ms

The recommendation is to use the Percentiles than the Histograms, they will be more accurate than how Prometheus computes them and CPU cheaper on Prometheus.

There are 3 levels of Miss latency summary : Service, Service + Region, Service + Region + PoP. Up to you to use the appropriate one per level
```
# HELP fastly_miss_summary_per_service fastly_miss_summary_per_service
# TYPE fastly_miss_summary_per_service summary
fastly_miss_summary_per_service{quantile="0.10",ser="ABC"} 151
fastly_miss_summary_per_service{quantile="0.25",ser="ABC"} 353
...
fastly_miss_summary_per_service_count{ser="ABC"} 446
fastly_miss_summary_per_service_sum{ser="ABC"} 299600

# HELP fastly_miss_summary_per_service_region fastly_miss_summary_per_service_region
# TYPE fastly_miss_summary_per_service_region summary
fastly_miss_summary_per_service_region{quantile="0.10",reg="Europe",ser="ABC"} 385
...
fastly_miss_summary_per_service_region_count{reg="Europe",ser="ABC"} 175
fastly_miss_summary_per_service_region_sum{reg="Europe",ser="ABC"} 115950

# HELP fastly_miss_summary_per_service_pop fastly_miss_summary_per_service_pop
# TYPE fastly_miss_summary_per_service_pop summary
fastly_miss_summary_per_service_pop{quantile="0.10",pop="MRS",reg="Europe",ser="ABC"} 400
...
fastly_miss_summary_per_service_pop_count{pop="MRS",reg="Europe",ser="ABC"} 9
fastly_miss_summary_per_service_pop_sum{pop="MRS",reg="Europe",ser="ABC"} 5600
```

You can specify which percentiles/quantiles you want in the configurations by
```
FRTATP_MISS_LATENCY_PERCENTILES=10,25,50,75,90,95
```

## Histograms for MISS latency
The histograms can be disabled by configuration. 
```
FRTATP_MISS_LATENCY_HISTOGRAMS=false
```

To have Prometheus/Grafana working properly, you need either to use 
- an histogram per level (Service, Service + Region, Service + Region + PoP) 
- or an histogram for all (Service + Region + PoP) but it requires that all (Service + Region + PoP) tuple have the same set of buckets if you want to compute the percentiles at the Region or Service levels. It leads to a lot of redundancy to fill up the blank. And it lead to Prometheus complaining about treating too many samples.

So the decision is to use 3 histograms, up to you to use the appropriate one per level

```
# HELP fastly_miss_histogram_per_service fastly_miss_histogram_per_service
# TYPE fastly_miss_histogram_per_service histogram
fastly_miss_histogram_per_service_bucket{ser="ABC",le="60"} 1
fastly_miss_histogram_per_service_bucket{ser="ABC",le="70"} 4
...
fastly_miss_histogram_per_service_count{ser="ABC"} 446
fastly_miss_histogram_per_service_sum{ser="ABC"} 299600

# HELP fastly_miss_histogram_per_service_region fastly_miss_histogram_per_service_region
# TYPE fastly_miss_histogram_per_service_region histogram
fastly_miss_histogram_per_service_region_bucket{reg="Europe",ser="ABC",le="200"} 1
fastly_miss_histogram_per_service_region_bucket{reg="Europe",ser="ABC",le="300"} 2
...
fastly_miss_histogram_per_service_region_count{reg="Europe",ser="ABC"} 175
fastly_miss_histogram_per_service_region_sum{reg="Europe",ser="ABC"} 115950

# HELP fastly_miss_histogram_per_service_pop fastly_miss_histogram_per_service_pop
# TYPE fastly_miss_histogram_per_service_pop histogram
fastly_miss_histogram_per_service_pop_bucket{pop="MRS",reg="Europe",ser="ABC",le="450"} 3
fastly_miss_histogram_per_service_pop_bucket{pop="MRS",reg="Europe",ser="ABC",le="500"} 4
...
fastly_miss_histogram_per_service_pop_count{pop="MRS",reg="Europe",ser="ABC"} 9
fastly_miss_histogram_per_service_pop_sum{pop="MRS",reg="Europe",ser="ABC"} 5600
```


## Ignore metrics that you don't need
The Fastly Real-time API returns a lot of metrics you may not be interested in. You can list the metrics patterns to ignore with a semi-column separated value list, with the beginning of the metrics name to ignore
ie.
```
FRTATP_IGNORE_METRICS="attack_;compute_;fanout_;imgopto;imgvideo;log;otfp;waf;websocket;billed;deliver_sub;error_;fetch_;hash_sub_;hit_sub_;object_size;pass_sub;predeliver_sub;prehash_sub;recv_sub;synth;video"
```

## NodeJs main.js options

## Docker
From the docker folder
to build the Docker images
```
docker-compose build
```

to run the Docker containers
```
docker-compose up
```

to stop the Docker containers
```
docker-compose down
```

## Defalut URLs
NodeJS : http://localhost:9145/metrics
Prometheus : http://localhost:9090
Grafana : : http://localhost:3000  (admin/admin)


## Generate the Debian Package
from macOS, you need to install dpkg first
```
brew install dpkg
```

Use the Makefile by running
```
make create_deb_package
```

## Install the Debian Package
```
sudo dpkg -i fastly-real-time-api-to-prometheus_x.x-x_amd64.deb
```

## Docker
You will find a Dockerfile in the nodejs folder to build a Docker image
To build :
```
docker build -t fastly-real-time-api_to_prometheus:1.0 .
```

To run a containter
```
docker run -p 9145:9145 --env-file config.txt -d fastly-real-time-api_to_prometheus:1.0 
or
docker run -p 9145:9145 -e FRTATP_FASTLY_KEY=... -d fastly-real-time-api_to_prometheus:1.0 
```

You can also use Docker to run a prometheus server
from https://prometheus.io/docs/prometheus/latest/installation/
```
docker run \
    -p 9090:9090 \
    -v ./prometheus/sample_config.yml:/etc/prometheus/prometheus.yml \
    prom/prometheus
```

You will find a docker-compose.yml in the docer folder. It will start a docker container on the image above, a prometheus and a grafana instance
From the docker folder:
```
docker-compose build
docker-compose up
docker-compose down
```
