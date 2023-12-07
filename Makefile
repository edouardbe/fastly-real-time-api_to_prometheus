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
	mkdir -p $(lib)/nodejs
	cp -R ./nodejs/* $(lib)/nodejs/
	cd $(lib)/nodejs/ && npm install
	mkdir -p $(etc)
	cp ./$(sample_configuration_file) $(etc)/
	mkdir -p $(system)
	cp ./service/fastly-real-time-api-to-prometheus.service $(service)
	mkdir -p $(package)/DEBIAN
	cp -r ./package/DEBIAN/* $(package)/DEBIAN/
	sed -i -E "s#(name)#$(name)#g" $(package)/DEBIAN/control
	sed -i -E "s#(version)#$(version)#g" $(package)/DEBIAN/control
	sed -i -E "s#(architecture)#$(architecture)#g" $(package)/DEBIAN/control
	sed -i -E "s#(name)#$(name)#g" $(package)/DEBIAN/postinst
	sed -i -E "s#(etc)#/etc/$(name)#g" $(package)/DEBIAN/postinst
	sed -i -E "s#(configuration_file)#$(configuration_file)#g" $(package)/DEBIAN/postinst
	sed -i -E "s#(sample_configuration_file)#$(sample_configuration_file)#g" $(package)/DEBIAN/postinst
	chmod 775 $(package)/DEBIAN/postinst
	dpkg-deb --build --root-owner-group $(package)	
	rm -fr $(package)