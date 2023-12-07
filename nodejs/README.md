# call the script from a node js express webserver

the advantage of using the node js version is that you will let your Prometheus server calling the script at the frequency specified in Prometheus, instead of having a cron or a service running AND an http server like Apache2 serving the updated data, even if Prometheus server does not fetch the data.

ie.
```
npm start -- --configuration-file=../config.txt -v
or
node main.js --configuration-file=../config.txt -v
```

options :
- --configuration-file= : to specify the configuration file. Recommended to set up the Fastly Api Key and Fastly Service.
- --bash-script-location : to specify where the bash script is located. Default is "../fastly-real-time-api-to-prometheus.sh" 
- --port= : to override the default port 9145 that nodejs will listen to
- --path= : to override the default path /metrics that nodejs will listen to
- --verbose|-v : if present, turn on the verbose mode.
- --bypass-initial-test : if present, bypass the initial run to check that the script has all the info to work.
- --output-dir= : to override the directory to write the computed data for prometheus. No need to change it by default
- --output-file= : to override the file to write the computed data for prometheus.  No need to change it by default
- --logs-dir= : to override the directory to write the logs
- --logs-file= : to override the file to write the logs
- --fastly-key= : the Fastly Key
- --fastly-service-id= : coma separated values of the services ids if you want to filter only on these services
- --ignore-metrics= : semi-column separated values of metrics to ignore
- --ignore-counter-zero= : ignore the counter if the value is 0
- --metric-prefix= : add a prefix to all metrics for prometheus
- --background-execution-period= : nb seconds between the background execution if the endpoint is not called
