{
	"translatorID": "c73a4a8c-3ef1-4ec8-8229-7531ee384cc4",
	"label": "Open WorldCat",
	"creator": "Simon Kornblith, Sebastian Karcher",
	"target": "^https?://[^/]+\\.worldcat\\.org/",
	"minVersion": "3.0.9",
	"maxVersion": "",
	"priority": 100,
	"inRepository": true,
	"translatorType": 12,
	"browserSupport": "gcsbv",
	"lastUpdated": "2015-06-07 17:46:05"
}

/**
 * Gets Zotero item from a WorldCat icon src
 */
function getZoteroType(iconSrc) {
	// only specify types not specified in COinS
	if (iconSrc.indexOf("icon-rec") != -1) {
		return "audioRecording";
	}
	if (iconSrc.indexOf("icon-com") != -1) {
		return "computerProgram";
	}
	if (iconSrc.indexOf("icon-map") != -1) {
		return "map";
	}
	return false;
}

/**
 * Generates a Zotero item from a single item WorldCat page,
 * or the first item on a multiple item page
 */
function generateItem(doc, co) {
	var item = new Zotero.Item();
	ZU.parseContextObject(co, item);
	// if only one, first check for special types (audio & video recording)
	var type = ZU.xpathText(doc,
		'//img[@class="icn"][contains(@src, "icon-")][1]/@src');
	if (type) {
		type = getZoteroType(type);
		if (type) item.itemType = type;
	}
	
	return item;
}

function getSearchResults(doc) {
	var results = doc.getElementsByClassName('result');
	for(var i=0; i<results.length; i++) {
		if(!results[i].getElementsByClassName('name').length) {
			delete results[i];
			i--;
		}
	}
	return results;
}

function getTitleNode(searchResult) {
	return ZU.xpath(searchResult, './div[@class="name"]/a')[0];
}

function getFirstContextObj(doc) {
	return ZU.xpathText(doc, '//span[@class="Z3988"][1]/@title');
}

function detectWeb(doc, url) {
	//distinguish from Worldcat Discovery
	if (doc.body.id == "worldcat"){
	    var results = getSearchResults(doc);

	    //single result
	    if(results.length) {
		return "multiple";
	    }

	    var co = getFirstContextObj(doc);
	    if(!co) return false;

	    // generate item and return type
	    return generateItem(doc, co).itemType;
	}
}

/**
 * Given an item URL, extract OCLC ID
 */
function extractOCLCID(url) {
	var id = url.match(/\/(\d+)(?=[&?]|$)/);
	if(!id) return false;
	return id[1];
}

/**
 * RIS Scraper Function
 *
 */
var baseURL = ''; //we need to set this when calling from doSearch
function scrape(ids, data) {
	var oclcID = ids.shift(),
		itemData = (data || []).shift();
	
	if (!oclcID) return;
	
	var risURL = baseURL + "/oclc/" + oclcID + "?page=endnotealt&client=worldcat.org-detailed_record";
	ZU.doGet(risURL, function (text) {
		//Z.debug(text);
		
		//2013-05-28 RIS export currently has messed up authors
		// e.g. A1  - Gabbay, Dov M., Woods, John Hayden., Hartmann, Stephan, 
		text = text.replace(/^((?:A[123U]|ED)\s+-\s+)(.+)/mg, function(m, tag, value) {
			var authors = value.replace(/[.,\s]+$/, '')
					.split(/[.,],/);
			var replStr = '';
			var author;
			for(var i=0, n=authors.length; i<n; i++) {
					author = authors[i].trim();
					if(author) replStr += tag + author + '\n';
			}
			return replStr.trim();
		});
		
		// Conference proceedings should be imported as book (below), but authors
		// are actually editors
		text = text.replace(/^TY\s+-\s+CONF\s[\s\S]*?^ER\s+-\s/mg, function(m) {
			if (!/^ED\s+-/m.test(m)) {
				m = m.replace(/^A[U1](\s+-)/mg, 'ED$1');
			}
			return m;
		})
		
		Zotero.debug("Importing corrected RIS: \n" + text);
		
		var translator = Zotero.loadTranslator("import");
		translator.setTranslator("32d59d2d-b65a-4da4-b0a3-bdd3cfb979e7");
		translator.setString(text);
		translator.setHandler("itemDone", function (obj, item) {
			item.extra = undefined;
			item.archive = undefined;

			if(item.libraryCatalog == "http://worldcat.org") {
				item.libraryCatalog = "Open WorldCat";
			}
			//remove space before colon
			item.title = item.title.replace(/\s+:/, ":")
			
			
			//correct field mode for corporate authors
			for (i in item.creators) {
				if (!item.creators[i].firstName){
					item.creators[i].fieldMode=1;
				}
			}
			
			//attach notes
			if(itemData && itemData.notes) {
				item.notes.push({note: itemData.notes});
			}
			
			item.complete();
		});
		
		translator.getTranslatorObject(function(trans) {
			trans.options.defaultItemType = 'book'; //if not supplied, default to book
			trans.options.typeMap = {
				'ELEC': 'book', //ebooks should be imported as books
				'CONF': 'book' // proceedings rather than papers
			};
			
			trans.doImport();
		});
		
		scrape(ids, data);
	});
}

function doWeb(doc, url) {
	var results = getSearchResults(doc);
	if(results.length) {
		var items = {}, itemData = {};
		for(var i=0, n=results.length; i<n; i++) {
			var title = getTitleNode(results[i]);
			if(!title || !title.href) continue;
			var url = title.href;
			var oclcID = extractOCLCID(url);
			if(!oclcID) {
				Zotero.debug("WorldCat: Failed to extract OCLC ID from URL: " + url);
				continue;
			}
			items[oclcID] = title.textContent;
			
			var notes = ZU.xpath(results[i], './div[@class="description" and ./strong[contains(text(), "Notes")]]');
			if(!notes.length) {
				//maybe we're looking at our own list
				notes = ZU.xpath(results[i], './div/div[@class="description"]/div[contains(@id,"saved_comments_") and normalize-space(text())]');
			}
			if(notes.length) {
				notes = ZU.trimInternal(notes[0].innerHTML)
					.replace(/^<strong>\s*Notes:\s*<\/strong>\s*<br>\s*/i, '');
				
				if(notes) {
					itemData[oclcID] = {
						notes: ZU.unescapeHTML(ZU.unescapeHTML(notes)) //it's double-escaped on WorldCat
					};
				}
			}
		}

		Zotero.selectItems(items, function(items) {
			if (!items) return true;
			
			var ids = [], data = [];
			for (var i in items) {
				ids.push(i);
				data.push(itemData[i]);
			}
			
			scrape(ids, data);
		});
	} else {
		var oclcID = extractOCLCID(url);
		if(!oclcID) throw new Error("WorldCat: Failed to extract OCLC ID from URL: " + url);
		scrape([oclcID]);
	}
}

function sanitizeInput(items, checkOnly) {
	if (items.length === undefined || typeof items == 'string') {
		items = [items];
	}
	
	var cleanItems = [];
	for (var i=0; i<items.length; i++) {
		var item = ZU.deepCopy(items[i]),
			valid = false;
		if (item.ISBN && typeof item.ISBN == 'string'
			&& (item.ISBN = ZU.cleanISBN(item.ISBN))
		) {
			valid = true;
		} else {
			delete item.ISBN;
		}
		
		if (item.identifiers && typeof item.identifiers.oclc == 'string'
			&& /^\d+$/.test(item.identifiers.oclc.trim())
		) {
			valid = true;
			item.identifiers.oclc = item.identifiers.oclc.trim();
		} else if (item.identifiers) {
			delete item.identifiers.oclc;
		}
		
		if (valid) {
			if (checkOnly) return true;
			cleanItems.push(item);
		}
	}
	
	return checkOnly ? !!cleanItems.length : cleanItems;
}

function detectSearch(items) {
	return sanitizeInput(items, true);
}

function doSearch(items) {
	items = sanitizeInput(items);
	if (!items.length) {
		Z.debug("Search query does not contain valid identifiers");
		return false;
	}
	
	baseURL = "http://www.worldcat.org"; // Translator-global
	
	var ids = [], isbns = [];
	for (var i=0; i<items.length; i++) {
		if (items[i].identifiers && items[i].identifiers.oclc) {
			ids.push(items[i].identifiers.oclc);
			continue;
		}
		
		isbns.push(items[i].ISBN);
	}
	
	fetchIDs(isbns, ids, function(ids) {
		if (!ids.length) {
			Z.debug("Could not retrieve any OCLC IDs");
			Zotero.done(false);
			return;
		}
		scrape(ids);
	});
}

function fetchIDs(isbns, ids, callback) {
	if (!isbns.length) {
		callback(ids);
		return;
	}
	
	var isbn = isbns.shift();
	var url = "http://www.worldcat.org/search?qt=results_page&q=bn%3A"
		+ encodeURIComponent(isbn);
	ZU.processDocuments(url,
		function (doc) {
			//we take the first search result
			var results = getSearchResults(doc);
			if (results.length) {
				var title = getTitleNode(results[0]);
				if (title) {
					var id = extractOCLCID(title.href);
					if (id) ids.push(id);
				} else {
					Z.debug("Could not extract OCLC ID for ISBN " + isbn);
				}
			} else {
				Z.debug("No search results found for ISBN " + isbn);
			}
		},
		function() {
			fetchIDs(isbns, ids, callback)
		}
	);
}

/** BEGIN TEST CASES **/
var testCases = [
	{
		"type": "web",
		"url": "http://www.worldcat.org/search?qt=worldcat_org_bks&q=argentina&fq=dt%3Abks",
		"items": "multiple"
	},
	{
		"type": "web",
		"url": "http://www.worldcat.org/title/argentina/oclc/489605&referer=brief_results",
		"items": [
			{
				"itemType": "book",
				"title": "Argentina",
				"creators": [
					{
						"lastName": "Whitaker",
						"firstName": "Arthur Preston",
						"creatorType": "author"
					}
				],
				"date": "1964",
				"language": "English",
				"libraryCatalog": "Open WorldCat",
				"place": "Englewood Cliffs, N.J.",
				"publisher": "Prentice-Hall",
				"attachments": [],
				"tags": [],
				"notes": [],
				"seeAlso": []
			}
		]
	},
	{
		"type": "web",
		"url": "http://www.worldcat.org/title/dynamic-systems-approach-to-the-development-of-cognition-and-action/oclc/42854423&referer=brief_results",
		"items": [
			{
				"itemType": "book",
				"title": "A dynamic systems approach to the development of cognition and action",
				"creators": [
					{
						"lastName": "Thelen",
						"firstName": "Esther",
						"creatorType": "author"
					},
					{
						"lastName": "Smith",
						"firstName": "Linda B",
						"creatorType": "author"
					}
				],
				"date": "1996",
				"ISBN": "0585030154  9780585030159",
				"language": "English",
				"libraryCatalog": "Open WorldCat",
				"place": "Cambridge, Mass.",
				"publisher": "MIT Press",
				"url": "http://search.ebscohost.com/login.aspx?direct=true&scope=site&db=nlebk&db=nlabk&AN=1712",
				"attachments": [],
				"tags": [],
				"notes": [],
				"seeAlso": []
			}
		]
	},
	{
		"type": "web",
		"url": "http://melvyl.worldcat.org/title/cambridge-companion-to-adam-smith/oclc/60321422&referer=brief_results",
		"items": [
			{
				"itemType": "book",
				"title": "The Cambridge companion to Adam Smith",
				"creators": [
					{
						"lastName": "Haakonssen",
						"firstName": "Knud",
						"creatorType": "author"
					}
				],
				"date": "2006",
				"ISBN": "0521770599 0521779243 9780521770590 9780521779241",
				"abstractNote": "\"Adam Smith is best known as the founder of scientific economics and as an early proponent of the modern market economy. Political economy, however, was only one part of Smith's comprehensive intellectual system. Consisting of a theory of mind and its functions in language, arts, science, and social intercourse, Smith's system was a towering contribution to the Scottish Enlightenment. His ideas on social intercourse, in fact, also served as the basis for a moral theory that provided both historical and theoretical accounts of law, politics, and economics. This companion volume provides an up-to-date examination of all aspects of Smith's thought. Collectively, the essays take into account Smith's multiple contexts - Scottish, British, European, Atlantic, biographical, institutional, political, philosophical - and they draw on all his works, including student notes from his lectures. Pluralistic in approach, the volume provides a contextualist history of Smith, as well as direct philosophical engagement with his ideas.\"--Jacket.",
				"language": "English",
				"libraryCatalog": "Open WorldCat",
				"place": "Cambridge; New York",
				"publisher": "Cambridge University Press",
				"attachments": [],
				"tags": [],
				"notes": [],
				"seeAlso": []
			}
		]
	},
	{
		"type": "web",
		"url": "http://www.worldcat.org/title/from-lanka-eastwards-the-ramayana-in-the-literature-and-visual-arts-of-indonesia/oclc/765821302",
		"items": [
			{
				"itemType": "book",
				"title": "From Laṅkā eastwards: the Rāmāyaṇa in the literature and visual arts of Indonesia",
				"creators": [
					{
						"lastName": "Acri",
						"firstName": "Andrea",
						"creatorType": "editor"
					},
					{
						"lastName": "Creese",
						"firstName": "Helen",
						"creatorType": "editor"
					},
					{
						"lastName": "Griffiths",
						"firstName": "Arlo",
						"creatorType": "editor"
					}
				],
				"date": "2011",
				"ISBN": "9067183849 9789067183840",
				"language": "English",
				"libraryCatalog": "Open WorldCat",
				"place": "Leiden",
				"publisher": "KITLV Press",
				"shortTitle": "From Laṅkā eastwards",
				"attachments": [],
				"tags": [],
				"notes": [],
				"seeAlso": []
			}
		]
	},
	{
		"type": "web",
		"url": "http://www.worldcat.org/title/newmans-relation-to-modernism/oclc/676747555",
		"items": [
			{
				"itemType": "book",
				"title": "Newman's relation to modernism",
				"creators": [
					{
						"lastName": "Smith",
						"firstName": "Sydney F",
						"creatorType": "author"
					}
				],
				"date": "1912",
				"language": "English",
				"libraryCatalog": "Open WorldCat",
				"place": "London",
				"publisher": "s.n.",
				"attachments": [],
				"tags": [],
				"notes": [],
				"seeAlso": []
			}
		]
	},
	{
		"type": "web",
		"url": "http://www.worldcat.org/title/cahokia-mounds-replicas/oclc/48394842&referer=brief_results",
		"items": [
			{
				"itemType": "book",
				"title": "[Cahokia Mounds replicas]",
				"creators": [
					{
						"lastName": "Grimont",
						"firstName": "Martha LeeAnn",
						"creatorType": "author"
					},
					{
						"lastName": "Mink",
						"firstName": "Claudia Gellman",
						"creatorType": "author"
					},
					{
						"lastName": "Cahokia Mounds Museum Society",
						"creatorType": "author",
						"fieldMode": 1
					}
				],
				"date": "2000",
				"ISBN": "1881563022  9781881563020",
				"language": "English",
				"libraryCatalog": "Open WorldCat",
				"place": "Collinsville, Ill.",
				"publisher": "Cahokia Mounds Museum Society]",
				"attachments": [],
				"tags": [],
				"notes": [],
				"seeAlso": []
			}
		]
	},
	{
		"type": "search",
		"input": {
			"ISBN": "9780585030159"
		},
		"items": [
			{
				"itemType": "book",
				"creators": [
					{
						"lastName": "Thelen",
						"firstName": "Esther",
						"creatorType": "author"
					},
					{
						"lastName": "Smith",
						"firstName": "Linda B",
						"creatorType": "author"
					}
				],
				"notes": [],
				"tags": [],
				"seeAlso": [],
				"attachments": [],
				"libraryCatalog": "Open WorldCat",
				"language": "English",
				"url": "http://search.ebscohost.com/login.aspx?direct=true&scope=site&db=nlebk&db=nlabk&AN=1712",
				"title": "A dynamic systems approach to the development of cognition and action",
				"publisher": "MIT Press",
				"place": "Cambridge, Mass.",
				"date": "1996",
				"ISBN": "9780585030159",
				"accessDate": "CURRENT_TIMESTAMP"
			}
		]
	},
	{
		"type": "search",
		"input": {
			"identifiers": {
				"oclc": "42854423"
			}
		},
		"items": [
			{
				"itemType": "book",
				"creators": [
					{
						"lastName": "Thelen",
						"firstName": "Esther",
						"creatorType": "author"
					},
					{
						"lastName": "Smith",
						"firstName": "Linda B",
						"creatorType": "author"
					}
				],
				"notes": [],
				"tags": [],
				"seeAlso": [],
				"attachments": [],
				"libraryCatalog": "Open WorldCat",
				"language": "English",
				"url": "http://search.ebscohost.com/login.aspx?direct=true&scope=site&db=nlebk&db=nlabk&AN=1712",
				"title": "A dynamic systems approach to the development of cognition and action",
				"publisher": "MIT Press",
				"place": "Cambridge, Mass.",
				"date": "1996",
				"ISBN": "9780585030159",
				"accessDate": "CURRENT_TIMESTAMP"
			}
		]
	}
]
/** END TEST CASES **/

