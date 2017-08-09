NODE_ENV=production forever -a -e logs/error.log start index.js
forever list
