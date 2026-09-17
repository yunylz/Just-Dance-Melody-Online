@echo off
title Just Dance Melody Online Server RELEASE 3.0
cd C:\Users\Administrator\Desktop\JDMO-Prod\main\main\
pm2 start processes.json --exp-backoff-restart-delay=100 
