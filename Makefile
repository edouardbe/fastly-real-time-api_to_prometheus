hello:
	echo "Hello, World"

install:
	mkdir -p /usr/local/lib/fastly-real-time-api_to_prometheus
	cp ./fastly-real-time-api_to_prometheus.sh /usr/local/lib/fastly-real-time-api_to_prometheus/fastly-real-time-api_to_prometheus.sh
	mkdir -p /usr/local/lib/fastly-real-time-api_to_prometheus/node
	cp -R ./nodejs/ /usr/local/lib/fastly-real-time-api_to_prometheus/nodejs/
	mkdir -p /etc/fastly-real-time-api_to_prometheus/
	cp -i ./sample_config.txt /etc/fastly-real-time-api_to_prometheus/config.txt
	@echo "SET UP THE VALUE OF FASTLY API KEY AND SERVICE ID IN /etc/fastly-real-time-api_to_prometheus/config.txt"
	cp -i ./service/fastly-real-time-api_to_prometheus.service /lib/systemd/system/fastly-real-time-api_to_prometheus.service
	apt install nodejs npm jq
	npm install /usr/local/lib/fastly-real-time-api_to_prometheus/nodejs/
	systemctl start fastly-real-time-api_to_prometheus
	
clean:
	systemctl stop fastly-real-time-api_to_prometheus
	rm -fr /usr/local/lib/fastly-real-time-api_to_prometheus/
	rm -fr /etc/fastly-real-time-api_to_prometheus/
	rm -fr /lib/systemd/system/fastly-real-time-api_to_prometheus.service
