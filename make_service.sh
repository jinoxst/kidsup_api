#!/bin/bash

sudo /usr/local/bin/forever-service install kidsupd -e "NODE_ENV=production" --script index.js --start -r "ec2-user" -f " -a -e logs/error.log"
forever list
