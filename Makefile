hello:
	echo "Hello, World"

service_macos:
	@echo "service_macos"
	mkdir -p /usr/local/lib/fastly-real-time-api_to_prometheus/node
	cp -R ./nodejs/ /usr/local/lib/fastly-real-time-api_to_prometheus/nodejs/
	mkdir -p /etc/fastly-real-time-api_to_prometheus/
	cp -i ./sample_config.txt /etc/fastly-real-time-api_to_prometheus/config.txt
	@echo "SET UP THE VALUE OF FASTLY API KEY AND SERVICE ID IN /etc/fastly-real-time-api_to_prometheus/config.txt"
	mkdir -p /lib/systemd/system/myservice.service

clean_macos:
	@echo "clean_macos"
	rm -fr /usr/local/lib/fastly-real-time-api_to_prometheus/
