---
layout: about
permalink: /
profile:
  align: right
  image: profile.jpg
  caption: "2025 @稻城亚丁"
published: true
---

你好，我是赵文海。  
软件工程师，写作者。  


我喜欢通过文字记录生活与思考，  
下面是我最新发布的文章：   

{% for post in site.posts limit: 3 %}
- [{{ post.title }}]({{ post.url | relative_url }}) · {{ post.date | date: '%Y-%m-%d' }}
{% endfor %}

你可以[在这里]({{ '/blog/' | relative_url }})阅读更多。


我平时喜欢阅读、听音乐、弹吉他，  
最近在学习 Blues 即兴演奏。   

我和妻子生活在北京，  
养了一只橘猫，叫「小五」。   

这里会持续更新我的作品。   

如果你想与我交流，  
可以通过页面下方的方式联系我。
