---
layout: post
description: /headache & weather data (2020)
category: chronicles
tags: pain headache weather data 2020
thumbnail-img: https://bartulem.github.io/img/pain2020.png
thumbnail-height: 215
post.thumbnail-width: 500
title: "another year of pain"
author: bartulem
date: 2021-01-24
---
<br/>
I've collected another year's worth of headache data. The good people of <a href="https://www.yr.no/" target="_blank">yr.no</a> offer some historical weather data for free, and for 2020, this included temperature, snow depth and precipitation oscillations.

You can see for each day of the year (temperature plot) or each date of the year (snow depth & precipitation plots) what the Trondheim measurement was and whether I had a headache (black dots; oouch!). For 2021, I've switched to <a href="https://openweathermap.org/" target="_blank">OpenWeatherMap</a>, as they offer much richer data I'm dynamically pulling every day (irrespective of my wordly location) using Cron.

<p class="text-center">
  <iframe src="https://chart-studio.plot.ly/~bartulm/276" width="700" height="900" align="left" frameborder="0" scrolling="no"></iframe>
</p>
