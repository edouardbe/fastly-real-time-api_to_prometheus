# call the script by a cron

- in /etc/crontab, add a line like this to run every minute
```
* * * * * root /bin/bash $PATH_TO_SCRIPT/fastly-real-time-api-to-prometheus.sh > /var/log/fastly-real-time-api-to-prometheus.log 2>&1
```

- Use --configuration-file or environment variables to set up the Fastly Api Key and Fastly Service Id
