<?

include_once("include/Imap.php");

class Component_mail extends Component {
  public static $default_transport = "virtual:";
  public static $default_vuid = "2001";
  public static $default_vgid = "2001";

  function init() {
    $this->orm = OrmManager::singleton();
    $this->orm->LoadModel("mail");
  }

  function controller_mail($args) {
    $vars["args"] = $args;
    if (!empty($args["domain"])) {
      $vars["domainname"] = $args["domain"];
    }
    return $this->GetComponentResponse("./mail.tpl", $vars);
  }
  function controller_domains($args) {
    if (!User::authorized("mail"))
      throw new Exception("not allowed");
    $vars["domains"] = $this->orm->select("MailDomain");
    return $this->GetComponentResponse("./domains.tpl", $vars);
  }
  function controller_domain($args) {
    if (!User::authorized("mail"))
      throw new Exception("not allowed");
    $vars["domain"] = any($args["domain"], $args["item"]);
    if (empty($vars["domain"]) && !empty($args["domainname"])) {
      $vars["domain"] = $this->orm->Load("MailDomain", $args["domainname"]);
    }
    $vars["showaccounts"] = any($args["showaccounts"], false);
    if (!empty($vars["domain"]) && !empty($vars["showaccounts"])) {
      $vars["accounts"] = $vars["domain"]->GetMailAccounts("ORDER BY username");
    }
    return $this->GetComponentResponse("./domain.tpl", $vars);
  }
  function controller_domain_create($args) {
    if (!User::authorized("mail"))
      throw new Exception("not allowed");
    $domain = new MailDomain();
    if (!empty($args["domain"])) {
      $transport = any($args["transport"], self::$default_transport);
      $domain->domain = $args["domain"];
      $domain->transport = $transport;
      try {
        $vars["success"] = 1;
        $this->orm->save($domain);
        header("Location: /elation/mail/");
      } catch(Exception $e) {
        $vars["success"] = 0;
      }
    }
    return $this->GetComponentResponse("./domain_create.tpl", $vars);
  }
  function controller_accounts($args) {
    if (!User::authorized("mail"))
      throw new Exception("not allowed");
    $vars["accounts"] = $args["accounts"];
    return $this->GetComponentResponse("./accounts.tpl", $vars);
  }
  function controller_account($args) {
    if (!User::authorized("mail"))
      throw new Exception("not allowed");
    $vars["account"] = any($args["account"], $args["item"]);
    return $this->GetComponentResponse("./account.tpl", $vars);
  }
  function controller_account_create($args) {
    if (!User::authorized("mail"))
      throw new Exception("not allowed");
    $vars["account"] = new MailAccount();
    if (!empty($args["domain"])) {
      $vars["account"]->domain = $args["domain"]->domain;
    }
    if (!empty($args["account"])) {
      foreach ($args["account"] as $k=>$v) {
        $vars["account"]->{$k} = ($k == "pass" && !empty($v) ? md5($v) : $v);
      }
      $vars["success"] = 0;
      // FIXME - this is ugly and could just be done with $vars["account"]->isValid() if we cleaned up validators
      if ((!empty($vars["account"]->username) && !empty($vars["account"]->domain)) &&
           (
             (!empty($vars["account"]->forward) && empty($vars["account"]->pass)) ||
             (!empty($vars["account"]->pass) && empty($vars["account"]->forward))
           )
         ) {
        if (empty($vars["account"]->forward))
          $vars["account"]->maildir = "_virtual_/" . $vars["account"]->domain . "/" . $vars["account"]->username . "/";
        try {
          $this->orm->save($vars["account"]);
          $vars["success"] = 1;
          header("Location: /elation/mail/?domain=".urlencode($vars["account"]->domain));
        } catch (Exception $e) {
        }
      } else {
      }
    }
    return $this->GetComponentResponse("./account_create.tpl", $vars);
  }

  /* IMAP client */
  public function getCredentials() {
    return array(
      "email" => "demo@supercriticalindustries.com", 
      "username" => "demo@supercriticalindustries.com", 
      "password" => "demo"
    );
  }
  public function getImap() {
    if (!$this->imap) {
      try {
        $creds = $this->getCredentials();
        $this->imap = new Imap("localhost:1143", $creds["username"], $creds["password"]);
      } catch (Exception $e) {
        $this->imap = false;
      }
    }
    return $this->imap;
  }
  public function getSmtp() {
    include_once("Mail.php");
    $creds = $this->getCredentials();
    $smtp = Mail::factory("smtp", array(
      "host" => "localhost",
      "auth" => true,
      "username" => $creds["username"],
      "password" => $creds["password"]
    ));
    return $smtp;
  }
  public function controller_client() {
    $vars["connected"] = false;
    return $this->GetComponentResponse("./client.tpl", $vars);
  }
  public function controller_folders($args) {
    $vars["connected"] = false;
    $imap = $this->getImap();
    if ($imap && $imap->isConnected()) {
      $vars["connected"] = true;
      $vars["folders"] = $imap->getFolders();
    }
    return $this->GetComponentResponse("./client.tpl", $vars);
  }
  public function controller_foldercounts($args) {
    $vars["connected"] = false;
    $imap = $this->getImap();
    if ($imap && $imap->isConnected()) {
      $vars["connected"] = true;
      $folders = $imap->getFolders();
      foreach ($folders as $mb) {
        $imap->selectFolder($mb);
        $vars["folders"][$mb] = array($imap->countMessages(), $imap->countUnreadMessages());
      }
    }
    return $this->GetComponentResponse("./client.tpl", $vars);
  }
  public function controller_messages($args) {
    $vars["connected"] = false;
    $vars["folder"] = any($args["folder"], "INBOX");
    $vars["pagesize"] = any($args["pagesize"], 250);
    $vars["page"] = any($args["page"], 1);

    $imap = $this->getImap();
    if ($imap && $imap->isConnected()) {
      $vars["connected"] = true;
      $imap->selectFolder($vars["folder"]);
      $vars["count"] = $imap->countMessages();
      $vars["unread"] = $imap->countUnreadMessages();
      if (!empty($args["start"])) {
        $vars["start"] = max(1, min($vars["count"], $args["start"]));
        if (!empty($args["end"])) {
          $vars["end"] = max(1, min($vars["start"], $args["end"]));
        } else {
          $vars["end"] = min($vars["count"], $vars["start"] + $vars["pagesize"] - 1);
        }
      } else {
        $vars["end"] = max(1, $vars["count"] - ($vars["page"] - 1) * $vars["pagesize"]);
        $vars["start"] = max(1, $vars["end"] - ($vars["pagesize"] - 1));
      }
      //$vars["messages"] = $imap->getMessages(false);
      $vars["messages"] = $imap->getOverview($vars["start"], $vars["end"] - $vars["start"]);
    }
    return $this->GetComponentResponse("./client.tpl", $vars);
  }
  public function controller_message($args) {
    $vars["connected"] = false;
    $vars["folder"] = any($args["folder"], "INBOX");
    $vars["message"] = any($args["message"], false);
    $imap = $this->getImap();
    if ($imap && $imap->isConnected()) {
      $vars["connected"] = true;
      $imap->selectFolder($vars["folder"]);
      $vars["messages"][$vars["message"]] = $imap->getMessage($vars["message"]);
    }
    return $this->GetComponentResponse("./message.tpl", $vars);
  }
  public function controller_message_seen($args) {
    $vars["connected"] = false;
    $vars["folder"] = any($args["folder"], "INBOX");
    $vars["message"] = any($args["message"], false);
    $vars["success"] = false;
    $imap = $this->getImap();
    if ($imap && $imap->isConnected()) {
      $vars["connected"] = true;
      $imap->selectFolder($vars["folder"]);

      $vars["success"] = $imap->setUnseenMessage($vars["message"], true);
    }
    return $this->GetComponentResponse("./message.tpl", $vars);
  }
  public function controller_message_attachment($args) {
    $vars["connected"] = false;
    $vars["folder"] = any($args["folder"], "INBOX");
    $vars["message"] = any($args["message"], false);
    $vars["attachmentid"] = any($args["attachmentid"], 0);
    $vars["success"] = false;
    $imap = $this->getImap();
    
    $typemap = array(
      "MESSAGE/RFC822" => "text/plain"
    );

    if ($imap && $imap->isConnected()) {
      $vars["connected"] = true;
      $imap->selectFolder($vars["folder"]);
      
      $vars["attachment"] = $imap->getAttachment($vars["message"], $vars["attachmentid"]);

      $this->root->request["contenttype"] = any($typemap[$vars["attachment"]["contentType"]], $vars["attachment"]["contentType"]);
    }
    return $this->GetComponentResponse("./message_attachment.tpl", $vars);
  }
  public function controller_send($args) {
    $creds = $this->getCredentials();
    $vars["success"] = false;
    if (!empty($args["to"]) && !empty($args["body"])) {
      //$vars["success"] = imap_mail($args["to"], $args["subject"], $args["body"]);

      $from = $creds["email"];
      $headers = array(
        "From" => $from,
        "To" => $args["to"],
        "Subject" => $args["subject"]
      );

      $smtp = $this->getSmtp();
      $imap = $this->getImap();
      if ($smtp && $imap) {
        $result = $smtp->send($args["to"], $headers, $args["body"]);
        if (PEAR::isError($result)) {
          $vars["success"] = false;
          $vars["message"] = $result->getMessage();
        } else {
          $vars["success"] = true;
          $vars["message"] = "OK";
          $headertext = "";
          foreach ($headers as $k=>$v) {
            $headertext .= "$k: $v\r\n";
          }
          $imap->saveMessageInSent($headertext, $args["body"]);
        }
      }
    } else {
      $vars["message"] = "Must specify recipients";
    }
    return $this->GetComponentResponse("./send.tpl", $vars);
  }
  public function controller_delete($args) {
    $vars["connected"] = false;
    $vars["folder"] = any($args["folder"], "INBOX");
    $vars["message"] = any($args["message"], false);
    $imap = $this->getImap();
    if ($imap && $imap->isConnected()) {
      $vars["connected"] = true;
      $imap->selectFolder($vars["folder"]);
      $vars["success"] = $imap->deleteMessages(explode(",", $vars["message"]));
    }
    return $this->GetComponentResponse("./message.tpl", $vars);
  }
}  
