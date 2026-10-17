package com.dreader;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class DreaderApplication {

	static {
		System.setProperty("java.net.preferIPv4Stack", "true");
		System.setProperty("java.net.preferIPv6Addresses", "false");
	}

	public static void main(String[] args) {
		SpringApplication.run(DreaderApplication.class, args);
	}

}
