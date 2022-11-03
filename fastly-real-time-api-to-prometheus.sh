#!/bin/bash

start=$(date +%s)
log () {
  if [ ! -z $VERBOSE ]; then
    echo "+$(($(date +%s) - ${start}))s: $1"
  fi
}

error () {
  >&2 echo "$1"
}

FRTATP_OUTPUT_DIR="."
FRTATP_OUTPUT_FILE="fastly-real-time-api-to-prometheus.data"
FRTATP_IGNORE_METRICS=""

while [ $# -gt 0 ]; do
  case $1 in
    -cf|--configuration-file)
      CONFIGURATION_FILE="$2"
      shift # past argument
      shift # past value
      ;;
    -fk|--fastly-key)
      CLI_FASTLY_KEY="$2"
      shift # past argument
      shift # past value
      ;;
    -fsi|--fastly-service-id)
      CLI_FASTLY_SERVICE_ID="$2"
      shift # past argument
      shift # past value
      ;;
    -od|--output-dir)
      CLI_OUTPUT_DIR="$2"
      shift # past argument
      shift # past value
      ;;
    -of|--output-file)
      CLI_OUTPUT_FILE="$2"
      shift # past argument
      shift # past value
      ;;
    -im|--ignore-metrics)
      CLI_IGNORE_METRICS="$2"
      shift # past argument
      shift # past value
      ;;
    -v|--verbose)
      VERBOSE=1
      shift # past argument
      ;;
    -h|--help)
      echo "usage: --fastly-key|-fk ABC --fastly-service-id|-fsi DEF --output-dir|-od /output/ --output-file|-of output.txt --ignore-metrics|-im \"attack_;compute_;semi-column-separated-values\""
      echo "usage: --configuration-file|-cf config.txt"
      echo "options: --verbose|-v to activate the verbose mode"
      echo ""
      echo "The Fastly Key and Service Id can be set as environment variables under FRTATP_FASTLY_KEY and FRTATP_FASTLY_SERVICE_ID"
      echo "The Outout directory and file can be set as environment variables under FRTATP_OUTPUT_DIR and FRTATP_OUTPUT_FILE"
      echo ""
      echo "If the configuration file declare the FRTATP_FASTLY_KEY, FRTATP_FASTLY_SERVICE_ID, FRTATP_OUTPUT_DIR or FRTATP_OUTPUT_FILE, they will override the environment variables"
      echo "If the command line will override the environment variables and configuration file values"
      echo ""
      echo "If you are not interested into all the Fastly Real Time metrics, list them to ignore with FRTATP_IGNORE_METRICS or --ignore-metrics|-im option, semi-column separated values, ie. \"attack_;compute_;fanout_;imgopto\" "
      echo ""
      echo "The Fastly Key and Service Id will be required to execute the script"
      echo "The default Output directory is by default the current directory"
      echo "The default Output file is ${FRTATP_OUTPUT_FILE}"
      exit 1
      ;;
    -*|--*)
      echo "Unknown option $1"
      exit 1
      ;;
  esac
done

log "start at $(date)"
log "arguments parsed"

if [ ! -z "$CONFIGURATION_FILE" ]; then
    log "parsing configuration file"
    if [ -f "$CONFIGURATION_FILE" ]; then
        grep -E "(FRTATP_FASTLY_KEY|FRTATP_FASTLY_SERVICE_ID|FRTATP_OUTPUT_DIR|FRTATP_OUTPUT_FILE|FRTATP_IGNORE_METRICS)=" "${CONFIGURATION_FILE}" > "${CONFIGURATION_FILE}.tmp"
        source "${CONFIGURATION_FILE}.tmp"
        rm -f "${CONFIGURATION_FILE}.tmp"
        log "configuration file parsed"
    else
        log "configuration file $CONFIGURATION_FILE does not exist"
        exit 1
    fi 
fi

if [ ! -z "$CLI_FASTLY_KEY" ]; then
    FRTATP_FASTLY_KEY="$CLI_FASTLY_KEY"
    log "Fastly Key given in the command line"
fi
if [ ! -z "$CLI_FASTLY_SERVICE_ID" ]; then
    FRTATP_FASTLY_SERVICE_ID="$CLI_FASTLY_SERVICE_ID"
    log "Fastly Service Id given in the command line"
fi
if [ ! -z "$CLI_OUTPUT_DIR" ]; then
    FRTATP_OUTPUT_DIR="$CLI_OUTPUT_DIR"
    log "Output directory given in the command line"
fi
if [ ! -z "$CLI_OUTPUT_FILE" ]; then
    FRTATP_OUTPUT_FILE="$CLI_OUTPUT_FILE"
    log "Output file given in the command line"
fi
if [ ! -z "$CLI_IGNORE_METRICS" ]; then
    FRTATP_IGNORE_METRICS="$CLI_IGNORE_METRICS"
    log "Ignore metrics given in the command line"
fi

log "arguments checking..."

if [ -z "$FRTATP_FASTLY_KEY" ]; then
    error "FRTATP_FASTLY_KEY can't be empty, set it up as an environment variable, in the a config file or with --fastly-key"
    exit 1
fi

if [ -z "$FRTATP_FASTLY_SERVICE_ID" ]; then
    error "FRTATP_FASTLY_SERVICE_ID can't be empty, set it up as an environment variable, in the a config file or with --fastly-service-id"
    exit 1
fi

log "output file will be at ${FRTATP_OUTPUT_DIR}/${FRTATP_OUTPUT_FILE}"
log "metrics to ignores are ${FRTATP_IGNORE_METRICS}"

log "arguments checked"

TEMP_NEW_REAL_TIME_DATA_FILE="${FRTATP_OUTPUT_FILE}.new.tmp"

# PoPs
log "fetching Fastly PoPs"
FASTLY_RESP=$(curl -w "%{http_code}" -s --location --request GET 'https://api.fastly.com/datacenters' \
--header 'Accept: application/json' \
--header "Fastly-Key: ${FRTATP_FASTLY_KEY}")
FASTLY_OK=$(echo $FASTLY_RESP|grep -o "200")

if [ -z $FASTLY_OK ]; then
  error "$FASTLY_RESP. Check your FASTLY API Key."
  exit 1
fi

FASTLY_POPS=$(echo $FASTLY_RESP| sed "s/200//g" |jq --compact-output --raw-output '.[] | "\(.code)>\(.group);"' |gawk '{printf "%s", $0}'|sed "s#Asia/Pacific#AP#g"|sed "s#Europe#EU#g"|sed "s#United States#US#g"|sed "s#Africa#AF#g"|sed "s#South America#SA#g")
if [ -z $FASTLY_POPS ]; then
  error "issue while fetching Fastly PoPs. Exit"
  exit 1
fi
log "Fastly PoPs fetched"

# Fresh real-time data
log "fetching Fastly Real-time data"
FASTLY_RESP=$(curl -w "%{http_code}" -s --location --request GET "https://rt.fastly.com/v1/channel/${FRTATP_FASTLY_SERVICE_ID}/ts/h" --header "Fastly-Key: ${FRTATP_FASTLY_KEY}")
FASTLY_OK=$(echo $FASTLY_RESP|grep -o -E "200$")

if [ -z $FASTLY_OK ]; then
  error "$FASTLY_RESP. Check your Fastly Service Id."
  exit 1
fi
echo $FASTLY_RESP|sed -E "s/200$//g" |jq --raw-output '.Data[] | .recorded, .datacenter' > "${FRTATP_OUTPUT_DIR}/${TEMP_NEW_REAL_TIME_DATA_FILE}"
NB_LINES=$(cat "${FRTATP_OUTPUT_DIR}/${TEMP_NEW_REAL_TIME_DATA_FILE}"|wc -l)
if [ "$NB_LINES" -eq 0 ]; then
  error "Fastly real-time API call returns nothing. Exit"
  exit 1
fi
log "Fastly Real-time data fetched"


# Erase previous data at midnight, to reset counters
d=$(date +%H%M%S)
if [ $d -eq 0 ]; 
then 
  log "Midnight : Reset counters"
  rm -f "${FRTATP_OUTPUT_DIR}/${FRTATP_OUTPUT_FILE}"
fi

# create the output file if it does not exit. Required by gawk.
if [ ! -f ${FRTATP_OUTPUT_DIR}/${FRTATP_OUTPUT_FILE} ]; then
  log "Create empty output file for gawk to work properly"
  echo "#" > "${FRTATP_OUTPUT_DIR}/${FRTATP_OUTPUT_FILE}"
fi


log "Start parsing the new Fastly Real-Time data and mix them with the previous ones"
gawk -v fastly_pops=$FASTLY_POPS -v ignore_metrics=$FRTATP_IGNORE_METRICS '
BEGIN{
    # parse the Fastly pops variable to extract the list of pops and their region.
    split(fastly_pops,pops_array,";")
    for( i in pops_array) {
        split(pops_array[i], popa, ">")
        pops_and_regions[popa[1]] = popa[2]
    }

    # keep the metrics to ignore in an array
    split(ignore_metrics,ignore_metrics_array,";")

    # in case of the first run
    previous_last_timestamp = 0
}
NR == FNR && !/^#/ {
    # load the previous counters
    previous_counters_array[$1] = $2
    # get the last timestamp read from the previous run. 
    if ( $1 == "last_timestamp") {
        previous_last_timestamp = $2
    }
}
NR != FNR && /^[0-9]+$/ {
    # track the last timestamp received to not count it twice
    last_timestamp=$0
    # ignore the next block of data if the last timestamp is already read
    if ( previous_last_timestamp >= last_timestamp ) {
        ignore="true"
    } else {
        ignore="false"
    }
}
NR != FNR && /"[A-Z]{3}[A-Z]*"/ {
    # just get the current pop
    match($0,/[A-Z]+/); 
    pop=substr($0,RSTART,RLENGTH)
}
NR != FNR && ! /"[A-Z]{3}"/ && /[a-z]+/ && $2 != "{" { 
    if ( ignore != true ) {
        # get the metric name and value for the current pop, and aggregate it for the [metric,pop] tuple
        metric=substr($1,2,length($1)-3);  
        metrics[metric]=1
        metrics_per_pop[metric,pop]+=$2
    }
}
NR != FNR && ! /"[A-Z]{3}"/ && /[a-z]+/ && $2 == "{" { 
    if ( ignore != true ) {
        # get the metric name, but the values are buckets in the next lines. Set histogram keyword for later
        metric=substr($1,2,length($1)-3) 
        metrics[metric]="histogram"
        metrics_per_pop[metric,pop]="histogram"
    }
}
NR != FNR && /"[0-9]+": [0-9]+/ { 
    if ( ignore != true ) {
        # get the bucket value for the current [metric,pop] tuple, and aggregate it
        bucket=int(substr($1,2,length($1)-3)); 
        buckets[bucket]=bucket
        metrics_pop_buckets[metric,pop,bucket]+=$2
    }
}
END{
    # print the pops and their regions for dependency in grafana
    printf "# HELP pops pops\n"
    printf "# TYPE pops gauge\n"
    for( i in pops_and_regions) {
        if (length(i) > 0 ) {
            printf "pops{pop=\"%s\",reg=\"%s\"} 1\n" , i, pops_and_regions[i]
        }
    }

    # print the last timestamp for the next iteration
    printf "# HELP last_timestamp last_timestamp\n"
    printf "# TYPE last_timestamp counter\n"
    printf "last_timestamp %i\n" , last_timestamp
    
    # sort the buckets
    asort(buckets)

    for (m in metrics) {
        # find out if the metric should be ignored
        ignore = "false"
        for (i in ignore_metrics_array) {
            if (length(ignore_metrics_array[i]) > 0 && index(m, ignore_metrics_array[i]) == 1) {
                ignore = "true"
            }
        }
        
        if (ignore == "true" ) {
            # ignore the metrics
        } else if ( metrics[m] != "histogram" ) {
            printf "# HELP %s %s\n", m,m
            printf "# TYPE %s counter\n", m
            for (p in pops_and_regions) {
                key=sprintf("%s{pop=\"%s\",reg=\"%s\"}",  m , p, pops_and_regions[p])
                previous_value=previous_counters_array[key]
                new_value=previous_value + metrics_per_pop[m,p]
                printf "%s{pop=\"%s\",reg=\"%s\"} %i\n" , m , p, pops_and_regions[p], new_value 
            } 
        } else {
            printf "# HELP %s %s\n", m,m
            printf "# TYPE %s histogram\n", m
            for (p in pops_and_regions) {
                if (length(p) != 0) {
                    sum=0
                    count=0
                    for (b in buckets) {
                        bucket=buckets[b]
                        nb_requests = metrics_pop_buckets[m,p,bucket]
                        #if ( length(nb_requests) > 0) {
                            count+=nb_requests
                            sum+=(nb_requests*bucket)
                            printf "%s_bucket{pop=\"%s\",reg=\"%s\",le=\"%i\"} %i\n" , m , p, pops_and_regions[p], bucket, count 
                        #}
                    }
                    printf "%s_bucket{pop=\"%s\",reg=\"%s\",le=\"%s\"} %i\n" , m , p, pops_and_regions[p], "+Inf", count 
                    printf "%s_sum{pop=\"%s\",reg=\"%s\"} %i\n" , m , p, pops_and_regions[p], sum 
                    printf "%s_count{pop=\"%s\",reg=\"%s\"} %i\n" , m , p, pops_and_regions[p], count
                }
            }
        }
    }
}
' "${FRTATP_OUTPUT_DIR}/${FRTATP_OUTPUT_FILE}" "${FRTATP_OUTPUT_DIR}/${TEMP_NEW_REAL_TIME_DATA_FILE}" > "${FRTATP_OUTPUT_DIR}/${FRTATP_OUTPUT_FILE}.tmp"

log "Fastly Real-time data parsed and counters/histogram updated"

mv -f "${FRTATP_OUTPUT_DIR}/${FRTATP_OUTPUT_FILE}.tmp" "${FRTATP_OUTPUT_DIR}/${FRTATP_OUTPUT_FILE}"
log "Delete the temp Fastly Real-time data"
rm -f "${FRTATP_OUTPUT_DIR}/${TEMP_NEW_REAL_TIME_DATA_FILE}"

exit 0