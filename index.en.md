---
layout: about
permalink: /en/
lang: en
profile:
  align: right
  image: profile.jpg
  caption: "2025 @Yading, Daocheng"
published: true
---

Hi, I'm Wenhai Zhao.  
Software engineer and writer.  

I write about life and thoughts through words.  
Here are the latest posts:  

{% for post in site.posts limit: 3 %}
- [{{ post.title }}]({{ post.url | relative_url }}) · {{ post.date | date: '%Y-%m-%d' }}
{% endfor %}

You can read more [here]({{ '/blog/' | relative_url }}).

I enjoy reading, listening to music, and playing guitar.  
Recently I'm learning blues improvisation.  

My wife and I live in Beijing,  
and we have an orange cat named "Xiao Wu."  

More writing will keep coming.  

If you'd like to reach me,  
you can use the links at the bottom of the page.
