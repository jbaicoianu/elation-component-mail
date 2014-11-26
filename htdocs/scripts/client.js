elation.require([
    'elation.collection', 
    'ui.infinilist', 
    'ui.keyvaluelist', 
    'ui.panel', 
    'ui.label', 
    'ui.window', 
    'ui.spinner', 
    'ui.buttonbar',
    //'ui.input',
    'ui.combobox',
    'ui.textarea',
    'ui.iframe',
  ], function() {

  elation.extend('mail.utils.parseEmail', function(str) {
    var sender = {full: str};
    var re = new RegExp(/^["']?(.*?)["']?\s+<(.*@.*)>/);
    var m = str.match(re);
    if (m) {
      sender.email = m[2];
      if (m[1] != m[2]) {
        sender.name = m[1];
      }
    } else if (str.match("@")) {
      sender.email = str;
    }
    return sender;
  });
  elation.extend('mail.utils.formatSender', function(sender) {
    if (elation.utils.isString(sender)) {
      sender = elation.mail.utils.parseEmail(sender);
    }
    if (sender) {
      if (!sender.name || sender.name == sender.email) {
        return '<a href="mailto:' + sender.email + '">' + sender.email + '</a>';
      } else {
        return '<a href="mailto:' + sender.email + '">' + sender.name + ' &lt;' + sender.email + '&gt;</a>';
      }
    }
    return str;
  });

  elation.component.add('mail.client', function() {
    this.defaultcontainer = { tag: 'div', classname: 'mail_client' };
    this.messages = {};
    this.composing = [];
    this.readmessagetimeout = 2000;

    this.init = function() {
      // data components
      this.folders = elation.collection.jsonapi({
        endpoint: '/mail/folders.js',
        datatransform: {
          items: function(d) {
            var folders = d.data.folders;
            return folders;
          }
        }
      });
      this.contacts = elation.collection.localindexed({
        storagekey: 'mail.client.contacts',
        index: 'email',
        indextransform: function(s) { if (s) return s.toLowerCase(); }
      });

      // UI components
      this.mainpanel = elation.ui.panel({
        append: this,
        orientation: 'horizontal'
      });
      this.toolbarpanel = elation.ui.panel({
        append: this.mainpanel,
        classname: 'mail_toolbar',
        orientation: 'horizontal'
      });
      this.toolbar = elation.ui.buttonbar({
        append: this.toolbarpanel,
        buttons: {
          newmessage: { 
            label: "&#x2709;",
            title: 'New Message',
            classname: 'mail_toolbar_newmessage',
            events: { click: elation.bind(this, this.handlenewmessage) }
          },
          contacts: { 
            label: "&#xe044;", 
            title: 'Contacts', 
            classname: 'mail_toolbar_contacts', 
            events: { click: elation.bind(this, this.handlecontacts) }
          },
          refresh: { 
            label: "&#xe082;", 
            title: 'Refresh', 
            disabled: true,
            classname: 'mail_toolbar_refresh',
            events: { click: elation.bind(this, this.handlerefresh) }
          },
          search: { 
            label: "&#xe028;", 
            title: 'Search', 
            classname: 'mail_toolbar_search',
            disabled: true,
            events: { click: elation.bind(this, this.handlesearch) }
          },
        }
      });
      this.folderslist = elation.ui.list({
        itemcollection: this.folders,
        classname: 'mail_folders_list',
        append: this.mainpanel,
        selected: 'INBOX',
        events: {
          ui_list_select: elation.bind(this, this.handleselectfolder)
        }
      });
      this.messagepanel = elation.ui.panel({
        append: this.mainpanel,
        classname: 'mail_message_panel',
        orientation: 'vertical'
      });
      this.messageslist = elation.ui.infinilist({
        append: this.messagepanel,
        classname: 'mail_message_list',
        spinner: elation.ui.spinner({}),
        selectable: true,
        multiselect: true,
        attrs: {
          itemcomponent: 'mail.messagesummary',
          itemplaceholder: '...'
        },
        events: {
          ui_list_select: elation.bind(this, this.handleselectmessage)
        }
      });
      this.messageview = elation.mail.messageview({
        append: this.messagepanel,
        classname: 'mail_message_view',
        events: {
          mail_messageview_delete: elation.bind(this, this.handledeletemessage)
        }
      });

      this.setfolder('INBOX');
    }
    this.setfolder = function(folder) {
      this.currentfolder = folder;

      // Create a new JSON API collection for this folder, if we don't have one already
      if (!this.messages[folder]) {
        this.messages[folder] = elation.collection.jsonapi({
          endpoint: '/mail/messages.js',
          apiargs: {
            folder: folder
          },
          datatransform: {
            items: function(d) {
              return d.data.messages.reverse();
            },
            count: function(d) {
              return d.data.count;
            }
          },
          events: {
            collection_load: elation.bind(this, this.handleloadmessages)
          }
        });
      } else {
        //this.refreshfolder();
      }
      // Update the messages list with this folder's collection
      this.messageslist.setItemCollection(this.messages[folder]);
    }
    this.refreshfolder = function(folder) {
      if (!folder) folder = this.currentfolder;
      this.messages[folder].load();
      this.toolbar.buttons.refresh.disabled = true;
    }
    this.viewmessage = function(msg) {
      this.messageview.setMessage(this.currentfolder, msg);
      if (this.messagereadtimer) {
        clearTimeout(this.messagereadtimer);
      }
      if (msg.unread) {
        this.messagereadtimer = setTimeout(elation.bind(this, function() { this.markmessageread(msg); }), this.readmessagetimeout); 
      }
    }
    this.composemessage = function(msg) {
      this.composing.push(elation.mail.composer({ append: this, message: msg, contacts: this.contacts }));
    }
    this.markmessageread = function(msg) {
      var params = { folder: this.currentfolder, message: msg.uid };
      var url = "/mail/message_seen.js?" + elation.utils.encodeURLParams(params);
      elation.ajax.Get(url);
      msg.unread = false;
      this.messageslist.refresh();
    }
    this.deletemessage = function(folder, message) {
      var args = {
        folder: folder,
        message: message.uid,
      };
      var url = '/mail/delete.js?' + elation.utils.encodeURLParams(args);
      elation.ajax.Get(url, null, { callback: elation.bind(this, this.handledeleted) });
    }
    this.showcontacts = function() {
      if (!this.contactwindow) {
        this.contactwindow = elation.mail.contacts({ append: this, contacts: this.contacts, title: 'Contacts' });
      }
      this.contactwindow.show();
    }

    /* event handlers */
    this.handleselectfolder = function(ev) {
      if (ev.data != this.currentfolder) {
        this.messageview.setMessage(false);
        this.setfolder(ev.data);
      }
    }
    this.handleselectmessage = function(ev) {
      this.viewmessage(ev.data);
    }
    this.handleloadmessages = function(ev) {
      var folder = this.messages[this.currentfolder];
      this.toolbar.buttons.refresh.disabled = false;
      
      for (var i = 0; i < folder.items.length; i++) {
        var e = folder.items[i];
        if (e.from) {
          this.contacts.add(elation.mail.utils.parseEmail(e.from));
        }
      }
    }
    this.handlenewmessage = function(ev) {
      this.composemessage();
    }
    this.handledeletemessage = function(ev) {
      var folder = ev.data.folder, message = ev.data.message;
      if (folder && message) {
        this.deletemessage(folder, message);
        if (this.messages[folder]) {
          this.messages[folder].remove(message);
console.log('bye bye');
        }
      }
    }
    this.handlecontacts = function(ev) {
      this.showcontacts();
    }
    this.handlerefresh = function(ev) {
      this.refreshfolder();
    }
    this.handlesearch = function(ev) {
    }
  });

  elation.component.add('mail.messagesummary', function() {
    this.init = function() {
      this.panel = elation.ui.panel({
        append: this,
        classname: 'mail_message',
        orientation: 'horizontal'
      });
      this.labels = {
        subject: elation.ui.label({
          append: this.panel,
          classname: 'mail_message_subject',
          label: this.args.subject
        }),
        from: elation.ui.label({
          append: this.panel,
          classname: 'mail_message_from',
          label: this.args.from
        }),
        date: elation.ui.label({
          append: this.panel,
          classname: 'mail_message_date',
          label: this.args.date
        }),
      }

      if (this.args.unread) {
        this.panel.addclass('state_unread');
      }
    }
  }, elation.ui.base);

  elation.component.add('mail.messageview', function() {
    this.init = function() {
      elation.mail.messageview.extendclass.init.call(this);
      this.message = this.args.message;

      this.headerpanel = elation.ui.panel({ append: this });
      this.buttons = elation.ui.buttonbar({
        append: this.headerpanel,
        classname: 'mail_messageview_buttons glyphicons',
        buttons: {
          reply: { 
            label: "&#xe222;",
            title: 'Reply',
            classname: 'mail_messageview_reply',
            events: { click: elation.bind(this, this.handlesendmessage) }
          },
          forward: { 
            label: "&#xe212;",
            title: 'Forward',
            classname: 'mail_messageview_forward',
            events: { click: elation.bind(this, this.handleattach) }
          },
          spam: { 
            label: "&#xe023;",
            title: 'Mark as Spam',
            toggletitle: 'Mark as Not Spam',
            toggle: true,
            classname: 'mail_messageview_spam',
            events: { click: elation.bind(this, this.handleattach) }
          },
          delete: { 
            label: "&#xe200;",
            title: 'Delete',
            classname: 'mail_messageview_delete',
            events: { click: elation.bind(this, this.handledelete) }
          },
        }
      });
      this.headers = elation.ui.keyvaluelist({
        append: this.headerpanel,
        classname: 'mail_message_view_headers',
        selectable: false,
        items: this.getHeaderSummary()
      });
/*
      this.body_content = elation.ui.panel({
        append: this,
        orientation: 'vertical',
        classname: 'mail_message_view_content'
      });
*/
      this.spinner = elation.ui.spinner({label: 'loading', type: 'dark'});
      this.body_iframe = elation.ui.iframe({
        append: this,
        classname: 'mail_message_view_content'
      });

      var iframecss = elation.html.create('link');
      iframecss.rel = 'stylesheet';
      iframecss.href = '/css/mail/client.css';
      this.body_iframe.container.contentDocument.head.appendChild(iframecss);
      

      this.msgapi = elation.collection.jsonapi({
        endpoint: '/mail/message.js',
        datatransform: {
          items: function(d) { return [ d.data.messages[d.data.message] ]; }
        }
      });
      elation.events.add(this.msgapi, 'collection_load', this);
      elation.events.add(window, 'resize', elation.bind(this, this.handleresize));
      this.refresh();
    }
    this.fetchcontent = function() {
      if (this.folder && this.message) {
        this.msgapi.apiargs = {
          folder: this.folder,
          message: this.message.uid
        };
        this.msgapi.clear();
        this.msgapi.load();
        this.spinner.show();
        this.container.appendChild(this.spinner.container);
      }
    }
    this.setMessage = function(folder, msg) {
      this.folder = folder;
      this.message = msg;
      this.fetchcontent();
      this.refresh();
    }
    this.render = function() {
      var headeritems = this.getHeaderSummary();
      this.headers.setItems(headeritems);

      var content = '';
      if (this.message) {
        this.buttons.enable();
        if (this.message.header) {
          this.buttons.buttons.spam.toggle(this.message.header['X-Spam-Flag'] == "YES");
        }
        if (this.message.body) {
          if (this.message.html) {
            content = this.message.body;
          } else {
            content = '<pre class="mail_message_view_content_text">' + this.message.body + '</pre>';
          }
        }
      } else {
        this.buttons.disable();
      }
      //this.body_content.container.innerHTML = content;
      this.body_iframe.setcontent(content);
      this.body_iframe.container.style.height = (this.container.offsetHeight - this.headerpanel.container.offsetHeight) + 'px';
    }
    this.getHeaderSummary = function() {
      var headeritems = [
          { key: 'From', value: ''},
          { key: 'Subject', value: ''},
          { key: 'Date', value: ''},
      ];
      if (this.message) {
        headeritems[0].value = elation.mail.utils.formatSender(this.message.from);
        headeritems[1].value = this.message.subject;
        headeritems[2].value = this.message.date;
        if (this.message.to) {
          if (elation.utils.isArray(this.message.to)) {
            for (var i = 0; i < this.message.to.length; i++) {
                headeritems.push({ key: (i == 0 ? 'To' : ''), value: elation.mail.utils.formatSender(this.message.to[i]) });
            }
          } else {
            headeritems.push({ key: 'To', value: elation.mail.utils.formatSender(this.message.to) });
          }
        }
        if (this.message.cc) {
          for (var i = 0; i < this.message.cc.length; i++) {
              headeritems.push({ key: (i == 0 ? 'Cc' : ''), value: elation.mail.utils.formatSender(this.message.cc[i]) });
          }
        }

        if (this.message.attachments) {
          for (var i = 0; i < this.message.attachments.length; i++) {
            var attachment = this.message.attachments[i];
console.log(this.message);
            var urlparams = { folder: this.folder, message: this.message.uid, attachmentid: i };
            var attachmenturl = "/mail/message_attachment.snip?" + elation.utils.encodeURLParams(urlparams);
            headeritems.push({ key: (i == 0 ? 'Attachment' : ''), value: '<a href="' + attachmenturl + '" target="_blank" class="mail_attachment ' + attachment.contentType.replace('/', '_') + '">' + attachment.name + '<span class="mail_attachment_size">' + Math.round(attachment.size / 1024) + 'kB</span></a>' });
          }
        }
      }
      return headeritems;
    }
    this.collection_load = function(ev) {
      this.spinner.hide();
      //this.message.body = this.msgapi.items[0].body;
      this.message = this.msgapi.items[0];
      this.refresh();
    }
    this.handleresize = function(ev) {
      this.refresh();
    }
    this.handlereply = function(ev) {
    }
    this.handleforward = function(ev) {
    }
    this.handlespam = function(ev) {
    }
    this.handledelete = function(ev) {
      elation.events.fire({type: 'mail_messageview_delete', element: this, data: { folder: this.folder, message: this.message } });
    }
  }, elation.ui.panel);
  elation.component.add('mail.composer', function() {
    this.init = function() {
      elation.mail.composer.extendclass.init.call(this);
      this.addclass('mail_composer');
      this.contentpanel = elation.ui.panel({
        orientation: 'vertical'
      });
      this.inputs = {
        to: { 
          key: 'To',
          value: elation.ui.combobox({
            inputname: 'mail[to]',
            autofocus: true,
            collection: this.args.contacts, 
            listattrs: { label: 'full', value: 'full', itemcomponent: 'mail.contact' },
          }) },
        cc: { 
          key: 'Cc',
          value: elation.ui.combobox({
            inputname: 'mail[cc]',
            collection: this.args.contacts, 
            listattrs: { label: 'full', value: 'full', itemcomponent: 'mail.contact' },
          }) },
/*
        cc2: { 
          key: '',
          value: elation.ui.combobox({
            inputname: 'mail[cc2]',
            collection: this.args.contacts, 
            listattrs: { label: 'full', value: 'full', itemcomponent: 'mail.contact' },
          }) },
        cc3: { 
          key: '',
          value: elation.ui.combobox({
            inputname: 'mail[cc3]',
            collection: this.args.contacts, 
            listattrs: { label: 'full', value: 'full', itemcomponent: 'mail.contact' },
          }) },
*/
        subject: { key: 'Subject', value: elation.ui.input({ inputname: 'mail[subject]'}) },
      }
      var tbpanel = elation.ui.panel({});
      this.buttons = elation.ui.buttonbar({
        append: tbpanel,
        classname: 'mail_composer_buttons',
        buttons: {
          sendmessage: { 
            label: "&#xe152;",
            title: 'Send Message',
            classname: 'mail_composer_sendmessage',
            events: { click: elation.bind(this, this.handlesendmessage) }
          },
          attach: { 
            label: "&#xe063;",
            title: 'Attach',
            disabled: true,
            classname: 'mail_composer_attach',
            events: { click: elation.bind(this, this.handleattach) }
          },
        }
      });
      this.headers = elation.ui.keyvaluelist({ 
        append: tbpanel,
        classname: 'mail_composer_headers',
        selectable: false,
        items: this.inputs 
      });
      this.settoolbar(tbpanel);
      this.body = elation.ui.textarea({ 
        append: this.contentpanel, 
        inputname: 'mail[body]', 
        classname: 'mail_compose_body',
        events: {
          ui_input_accept: elation.bind(this, this.handlesendmessage)
        }
      });

      elation.events.add(this.inputs.subject.value, 'ui_input_change', elation.bind(this, this.handlesubjectchange));

      this.setcontent(this.contentpanel);
      this.handlesubjectchange();
      this.center();
    }
    this.sendmessage = function() {
      var args = {
        to: this.inputs.to.value.value,
        subject: this.inputs.subject.value.value,
        body: this.body.value
      };
      var url = '/mail/send.js?' + elation.utils.encodeURLParams(args);
      elation.ajax.Get(url, null, { callback: elation.bind(this, this.handlemessagesent) });
      this.disable();
console.log('sending...');
      this.args.contacts.add(elation.mail.utils.parseEmail(this.inputs.to.value.value));
      this.spinner = elation.ui.spinner({full: true, label: 'sending', append: this});
    }
    this.enable = function() {
      for (var k in this.inputs) {
        this.inputs[k].value.enable();
      }
      this.body.enable();
    }
    this.disable = function() {
      for (var k in this.inputs) {
        this.inputs[k].value.disable();
      }
      this.body.disable();
    }
    this.handlesubjectchange = function(ev) {
      var subject = this.inputs.subject.value.value || '(no subject)';
      this.settitle('New message: ' + subject);
    }
    this.handlesendmessage = function(ev) {
      this.sendmessage();
    }
    this.handlemessagesent = function(responsetxt) {
      this.spinner.hide();
      //this.close();
      var response = JSON.parse(responsetxt);
console.log('done sending', response);
      if (response.data.success) {
        this.close();
      } else {
        this.enable();
      }
    }
  }, elation.ui.window);

  elation.component.add('mail.contacts', function() {
    this.init = function() {
      elation.mail.contacts.extendclass.init.call(this);
      this.addclass('mail_contacts');
      this.contacts = this.args.contacts;
      this.contactlist = elation.ui.infinilist({
        append: this,
        classname: 'mail_contacts_list',
        itemcollection: this.contacts,
        attrs: {
          itemcomponent: 'mail.contact'
        }
      });
      this.center();
      elation.events.add(this.contacts, 'collection_add', this);
    }
    this.collection_add = function(ev) {
      // FIXME - super hacky.  This is all to keep the list sorted when new items are added, which should happen automatically
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(elation.bind(this, function() { this.contactlist.sort('email'); console.log('sorty'); }), 10);
    }
  }, elation.ui.window);
  elation.component.add('mail.contact', function() {
    this.init = function() {
      elation.mail.contact.extendclass.init.call(this);
      this.namelabel = elation.ui.label({
        append: this,
        classname: 'mail_contact_name',
        label: this.args.name
      });
      this.emaillabel = elation.ui.label({
        append: this,
        classname: 'mail_contact_email',
        label: this.args.email
      });
    }
  }, elation.ui.listitem);
});
