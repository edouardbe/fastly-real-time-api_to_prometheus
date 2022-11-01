hello:
	echo "Hello, World"

name=fastly-real-time-api-to-prometheus
version=1.0
revision=1
architecture=amd64
package=$(name)_$(version)-$(revision)_$(architecture)
lib=$(package)/usr/local/lib/$(name)
etc=$(package)/etc/$(name)
configuration_file=config.txt
sample_configuration_file=sample_config.txt
system=$(package)/lib/systemd/system
service=$(system)/$(name).service

create_deb_package:
	rm -f $(package).deb
	mkdir -p $(package)
	mkdir -p $(lib)
	cp ./fastly-real-time-api-to-prometheus.sh $(lib)/
	mkdir -p $(lib)/nodejs
	cp -R ./nodejs/* $(lib)/nodejs/
	cd $(lib)/nodejs/ && npm install
	mkdir -p $(etc)
	cp ./$(sample_configuration_file) $(etc)/
	mkdir -p $(system)
	cp ./service/fastly-real-time-api-to-prometheus.service $(service)
	mkdir -p $(package)/DEBIAN
	cp -r ./package/DEBIAN/* $(package)/DEBIAN/
	sed -i -E "s#\(name\)#$(name)#g" $(package)/DEBIAN/control
	sed -i -E "s#\(version\)#$(version)#g" $(package)/DEBIAN/control
	sed -i -E "s#\(architecture\)#$(architecture)#g" $(package)/DEBIAN/control
	sed -i -E "s#\(name\)#$(name)#g" $(package)/DEBIAN/postinst
	sed -i -E "s#\(etc\)#/etc/$(name)#g" $(package)/DEBIAN/postinst
	sed -i -E "s#\(configuration_file\)#$(configuration_file)#g" $(package)/DEBIAN/postinst
	sed -i -E "s#\(sample_configuration_file\)#$(sample_configuration_file)#g" $(package)/DEBIAN/postinst
	chmod 775 $(package)/DEBIAN/postinst
	dpkg-deb --build --root-owner-group $(package)	
	rm -fr $(package)

install:
	mkdir -p /usr/local/lib/fastly-real-time-api-to-prometheus
	cp ./fastly-real-time-api-to-prometheus.sh /usr/local/lib/fastly-real-time-api-to-prometheus/fastly-real-time-api-to-prometheus.sh
	mkdir -p /usr/local/lib/fastly-real-time-api-to-prometheus/nodejs/
	cp -R ./nodejs/* /usr/local/lib/fastly-real-time-api-to-prometheus/nodejs/
	mkdir -p /etc/fastly-real-time-api-to-prometheus/
	cp -i ./sample_config.txt /etc/fastly-real-time-api-to-prometheus/config.txt
	FASTLY_API_KEY ?= $(shell bash -c 'read -p "FASTLY_API_KEY: " FASTLY_SERVICE_ID; echo $$FASTLY_API_KEY')
	FASTLY_SERVICE_ID ?= $(shell bash -c 'read -s -p "FASTLY_SERVICE_ID: " FASTLY_SERVICE_ID; echo $$FASTLY_SERVICE_ID')
	@echo "SET UP THE VALUE OF FASTLY API KEY AND SERVICE ID IN /etc/fastly-real-time-api-to-prometheus/config.txt"
	cp -i ./service/fastly-real-time-api-to-prometheus.service /lib/systemd/system/fastly-real-time-api-to-prometheus.service
	apt install nodejs npm jq
	cd /usr/local/lib/fastly-real-time-api-to-prometheus/nodejs/ && npm install
	systemctl start fastly-real-time-api-to-prometheus
	
clean:
	systemctl stop fastly-real-time-api-to-prometheus
	systemctl daemon-reload
	rm -fr /usr/local/lib/fastly-real-time-api-to-prometheus/
	rm -fr /etc/fastly-real-time-api-to-prometheus/
	rm -fr /lib/systemd/system/fastly-real-time-api-to-prometheus.service
