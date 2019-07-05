#!/usr/bin/env node

"use strict";
const http = require('http');
const fs = require('fs');
const process = require('process');
const bodyParser = require('body-parser');


// --------------------------------------------------------------------------------------
// SECTION: Initialization
// This code sets configuration values and retrieves the server state from a JSON file
// --------------------------------------------------------------------------------------
//
const dataFilePath = './scripts/data.json'
var JSONData = require( dataFilePath);    // Reads the JSON data file to get current server state

// Google Stackdriver Monitoring initialization
const {google} = require('googleapis');
const monitoring = require('@google-cloud/monitoring');
const client = new monitoring.MetricServiceClient();
var projectId = "";
var pod_guid = "";
var namespace_name = "";
var zone_name = "";
var cluster_name = "";
var pod_name = "";

// Initialize the JSON file to false and 0 users
var cpuLoadRunning = false;
var userCount = 0;
JSONData.CpuIsRunning = cpuLoadRunning;
JSONData.UserCount = userCount;
setTimeout(initData, 2000);	// Wait for the file to be ready, then initialize its contents

// Set the configuration using Environment variables and GCP Metadata
getMetadata();
pod_guid = process.env.POD_ID;
namespace_name = process.env.NAMESPACE;
pod_name = process.env.HOSTNAME;


// --------------------------------------------------------------------------------------
// SECTION: Express Engine configuration
// This code sets up the Express web engine and its endpoints (called routes)
// --------------------------------------------------------------------------------------
//
const express = require('express');
const app = express();
const path = require('path');
const router = express.Router();
var server = http.createServer(app);

router.get('/',function(req,res){
  res.sendFile(path.join(__dirname+'/index.html'));
});

// Store all client-side JS, CSS, and user-readable data files in the scripts folder.
app.use("/scripts", express.static(__dirname + '/scripts'));
app.use('/', router);

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());



// --------------------------------------------------------------------------------------
// SECTION: Endpoint Handlers
// This code handles button click events and launches the appropriate functions
// --------------------------------------------------------------------------------------
//
app.post('/StartCPU', function(req, res) {
	cpuLoadRunning = true;
	JSONData.CpuIsRunning = cpuLoadRunning;
	fs.writeFile(dataFilePath, JSON.stringify(JSONData, null, 2), errorHandler);
	res.redirect("/");
	cpuEventLoop();
	console.log(getDateTime() + ',DEBUG, Message: CPU load started');
});

app.post('/StopCPU', function(req, res) {
	cpuLoadRunning = false;
	JSONData.CpuIsRunning = cpuLoadRunning;
	fs.writeFile(dataFilePath, JSON.stringify(JSONData, null, 2), errorHandler);
	res.redirect("/");
	console.log(getDateTime() + ',DEBUG, Message: CPU load stopped');
});

app.post('/StartMonitoring', function(req, res) {
	res.redirect("/");

	createStackdriverMetricDescriptor()
	.then(result => startMonitoring(result))
	.then(endResult => {
	  console.log(getDateTime() + ',DEBUG, Message: Custom Metric export started.');
	})
	.catch(() => {
	  console.log(getDateTime() + ',ERROR, Message: Custom Metric export failed.');
	});
});

app.post('/IncreaseUsers', function(req, res) {
	userCount = JSONData.UserCount
	userCount = userCount + 1
	JSONData.UserCount = userCount;
	fs.writeFile(dataFilePath, JSON.stringify(JSONData, null, 2), errorHandler);
	res.redirect("/");
	console.log(getDateTime() + ',DEBUG, Message: User Count now: ' + userCount);
});

app.post('/DecreaseUsers', function(req, res) {
	userCount = JSONData.UserCount
	if (userCount > 0) {
		userCount = userCount - 1
		JSONData.UserCount = userCount;
		fs.writeFile(dataFilePath, JSON.stringify(JSONData, null, 2), errorHandler);
		res.redirect("/");
	}
	else {
		userCount = 0;
	}
	console.log(getDateTime() + ',DEBUG, Message: User Count now: ' + userCount);
});

app.post('/SendLogCritical', function(req, res) {
	res.redirect("/");
	console.log(getDateTime() + ',CRITICAL, Message: This is a test of a CRITICAL log entry.');
});

app.post('/SendLogError', function(req, res) {
	res.redirect("/");
	console.log(getDateTime() + ',ERROR, Message: This is a test of an ERROR log entry.');
});

app.post('/SendLogWarning', function(req, res) {
	res.redirect("/");
	console.log(getDateTime() + ',WARNING, Message: This is a test of a WARNING log entry.');
});

app.post('/SendLogInformational', function(req, res) {
	res.redirect("/");
	console.log(getDateTime() + ',INFO, Message: This is a test of an INFORMATIONAL log entry.');
});


// --------------------------------------------------------------------------------------
// SECTION: Routines
// Everything after this section will be functions
// --------------------------------------------------------------------------------------
//

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(getDateTime() + ',DEBUG, Message: Web server listening on port', port);
});


// --------------------------------------------------------------------------------------
// SECTION: Main Functions
// Code called from the press of buttons.
// --------------------------------------------------------------------------------------
//
function initData() {
	fs.writeFile(dataFilePath, JSON.stringify(JSONData, null, 2), errorHandler);
}

function sleep(ms){
    return new Promise(resolve=>{
        setTimeout(resolve,ms)
    })
}

function startMonitoring() {
	//This function starts the export of custom metrics to Stackdriver, which occurs once per minute.
	setInterval(metricExport, 60000);
}

async function cpuEventLoop() {
	var answer = 0;
	while (cpuLoadRunning) {
		for (var i = 0; i < 10000000; i++) {
			answer += Math.random() * Math.random();
		}
		await sleep(1);
	}
	return answer;
}

function metricExport() {
	writeStackdriverMetricData();
	console.log(getDateTime() + ',DEBUG, Message: Exporting metrics... userCount = ' + userCount);
}

async function getMetadata() {
	// Get the project information from GCP
	projectId = await google.auth.getProjectId();
	zone_name = await getZoneName();
	cluster_name = await getClusterName();
}

function getClusterName() {
	var options = {
		host: 'metadata',
		port: 80,
		path: '/computeMetadata/v1/instance/attributes/cluster-name',
		method: 'GET',
		headers: {
			"Metadata-Flavor": 'Google'
		}
	};
	var callback = function(response) {
	  var str = "";
	  response.on('data', function (chunk) {
		str += chunk;
	  });
	  response.on('end', function () {
		if (str.length < 128) {
		  cluster_name = str;
		}
		else {
		  cluster_name = 'no_cluster_name';
		}
	  });
	}
	var req = http.request(options, callback).end();
	
	return cluster_name;
}

function getZoneName() {
	var options = {
		host: 'metadata',
		port: 80,
		path: '/computeMetadata/v1/instance/zone',
		method: 'GET',
		headers: {
			"Metadata-Flavor": 'Google'
		}
	};
	var callback = function(response) {
	  var str = "";
	  response.on('data', function (chunk) {
		str += chunk;
	  });
	  response.on('end', function () {
		if (str.length < 128) {
		  var array1 = str.split("/");
		  zone_name = array1[3];
		}
		else {
		  zone_name = 'no_zone_name';
		}
	  });
	}
	var req = http.request(options, callback).end();
	return zone_name;
}

async function createStackdriverMetricDescriptor() {
	// This function will create the metric descriptor for the timeSeries data
	// The descriptor is only created once.
	const request = {
	  name: client.projectPath(projectId),
	  metricDescriptor: {
		description: 'TEST METRIC - Number of active users in the web application.',
		displayName: 'Web App - Active Users',
		type: 'custom.googleapis.com/webapp/active_users',
		metricKind: 'GAUGE',
		valueType: 'DOUBLE',
		unit: '{users}',
		labels: [
		  {
			key: 'pod_id',
			valueType: 'STRING',
			description: 'The ID of the pod.',
		  },
		],
	  },
	};
	// Creates a custom metric descriptor
	const [descriptor] = await client.createMetricDescriptor(request);
	console.log(getDateTime() + ',DEBUG, Message: Created custom metric in Stackdriver.');
}

async function writeStackdriverMetricData() {
	// This section is for writing the data to Stackdriver
	// This code is executed once every minute to publish the value of the custom metric
	//
	// This function uses the global variable "userCount" for its value
	//
	const dataPoint = {
	  interval: {
		endTime: {
		  seconds: Date.now() / 1000,
		},
	  },
	  value: {
		doubleValue: userCount,
	  },
	};
	const timeSeriesData = {
	  metric: {
		type: 'custom.googleapis.com/webapp/active_users',
		labels: {
		  pod_id: pod_guid,
		},
	  },
	  resource: {
		type: 'k8s_pod',
		labels: {
		  project_id: projectId,
		  location: zone_name,
		  cluster_name: cluster_name,
		  namespace_name: namespace_name,
		  pod_name: pod_name,
		},
	  },
	  points: [dataPoint],
	};
	const request = {
	  name: client.projectPath(projectId),
	  timeSeries: [timeSeriesData],
	};
	// Writes time series data
	const result = await client.createTimeSeries(request);
}

function getDateTime() {
	let now     = new Date(); 
	let year    = now.getFullYear();
	let month   = now.getMonth()+1; 
	let day     = now.getDate();
	let hour    = now.getHours();
	let minute  = now.getMinutes();
	let second  = now.getSeconds(); 
	if(month.toString().length == 1) {
		 month = '0'+month;
	}
	if(day.toString().length == 1) {
		 day = '0'+day;
	}   
	if(hour.toString().length == 1) {
		 hour = '0'+hour;
	}
	if(minute.toString().length == 1) {
		 minute = '0'+minute;
	}
	if(second.toString().length == 1) {
		 second = '0'+second;
	}   
	let dateTime = year+'/'+month+'/'+day+' '+hour+':'+minute+':'+second;   
	return dateTime;
}

// --------------------------------------------------------------------------------------
// SECTION: Error Handling
// This code (hopefully) catches all the errors and exceptions raised in the app
// --------------------------------------------------------------------------------------
//
var errorHandler = function() {
	//TODO
}


// --------------------------------------------------------------------------------------
// SECTION: Code Graveyard
// All code below this point is not called and should be disposable
// --------------------------------------------------------------------------------------
//

// 	function displayVars() {
// 		console.log(getDateTime() + ',DEBUG, Message: project id is: ' + projectId);
// 		console.log(getDateTime() + ',DEBUG, Message: cluster name is: ' + cluster_name);
// 		console.log(getDateTime() + ',DEBUG, Message: zone name is: ' + zone_name);
// 	}
