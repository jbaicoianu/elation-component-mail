{foreach from=$messages item=msg}
  {if $msg.html}
    {$msg.body}
  {else}
    <pre class="mail_message_view_content_text">{$msg.body|escape:html}</pre>
  {/if}
{/foreach}

