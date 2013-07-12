// codebasetime.js
//
// Chrome extension content script to reformat estimated times on the codebasehq.com web site.
//
// Codebase (www.codebasehq.com) is a project hosting site for source repositories and ticket
// tracking. The ticketing system supports input and display of estimated times for tasks, but
// times are always displayed in minutes and no summaries are calculated.
//
// This extension formats codebase time display into human-readable form and adds summaries of
// total time for open and closed tickets. Formatting is applied in the ticket list page,
// milestone summary page, and in the entry of new time estimates for individual tickets.
//
// Version 1.0.0 November 2011 / Yossarian King
// Copyleft 2011 Zero and One Computing, no rights reserved.


// Feature ideas ...
// TODO: break out in progress / in review tickets separate from open and closed
// TODO: make HoursPerWorkDay a configurable setting
// TODO: on ticket report, show total and remaining time separately - would Just Work if codebase used <tr class="e open">, etc.
// TODO: extract milestone deadline and display available time remaining
// TODO: full milestone pie chart by ticket status, not just open/closed - make this a separate extension, or at least a different script


// 
// Globals.
//

var gMilestoneTimeDLNode = null;
var gCurrentTab = "";
var gTotalOpen = new TimeEstimate(0, 0, 0);
var gTotalClosed = new TimeEstimate(0, 0, 0);


// 
// TimeEstimate object stores and manipulates hours/minutes/seconds (and counts unknown tasks).
//

// Constants.
const cHoursPerWorkDay = 8;

function TimeEstimate(days, hours, minutes)
{
    this.normalize = function(hoursPerDay)
    {
        this.hours += Math.floor(this.minutes / 60);
        this.days += Math.floor(this.hours / hoursPerDay);
        this.minutes = this.minutes % 60;
        this.hours = this.hours % hoursPerDay;
    };

    this.add = function(other)
    {
        // add each component
        this.days += other.days;
        this.hours += other.hours;
        this.minutes += other.minutes;
        this.unknown += other.unknown;
        
        // normalize by work days
        this.normalize(cHoursPerWorkDay);
    };

    this.addMinutes = function(minutes)
    {
        this.add(new TimeEstimate(0, 0, minutes));
    };
    
    this.zero = function()
    {
        return (this.days + this.hours + this.minutes + this.unknown == 0);
    };
    
    this.format = function()
    {
        var formatted = "";
        if (this.days > 0)
            formatted += this.days + "d ";
        if (this.hours > 0)
            formatted += this.hours + "h ";
        if (this.minutes > 0)
            formatted += this.minutes + "m ";
        if (this.unknown > 0)
        {
            if (formatted.length > 0)
            {
                formatted += "+ ";
            }
            formatted += this.unknown + "? ";
        }
        return formatted;
    }

    this.days = days;
    this.hours = hours;
    this.minutes = minutes;
    this.unknown = 0;
    
    // Normalize for total duration.
    this.normalize(24);
}


// 
// Formatting functions iterate the document looking for estimated times to massage.
//

function formatTimes(node)
{
    if (node.nodeType == 1)
    {
        if (node.tagName == "TBODY")
        {
            // Update times in body of all tables.
            formatTableTimes(node);
        }
        else if ((node.tagName == "DL") && (node.innerHTML.indexOf("Estimated Time") >= 0))
        {
            // Remember where the milestone summary info is stored.
            gMilestoneTimeDLNode = node;
        }
        else if ((node.tagName == "DD") && (node.className == "estimated_time"))
        {
            // Update text entry box for updating estimate time on individual tickets.
            formatTimeEstimateInput(node);
        }
        else
        {
            // Cheesy way to tell which tab we're processing, so we know when to add up totals.
            if (node.tagName == "LI")
            {
                gCurrentTab = node.className;
            }
            
            // Iterate children.
            for (var i = 0; i < node.childNodes.length; i++)
            {
                formatTimes(node.childNodes[i]);
            }
        }
    }
}

function formatTableTimes(tableBodyNode)
{
    var open = new TimeEstimate(0, 0, 0);
    var closed = new TimeEstimate(0, 0, 0);
    var ncols = 0;
    var showSummary = false;

    // Iterate each row.
    for (var i = 0; i < tableBodyNode.childNodes.length; i++)
    {
        var rowNode = tableBodyNode.childNodes[i];
        if (rowNode.tagName != "TR")
            continue;

        // Count columns in first row.
        var countThisRow = (ncols == 0);
            
        for (var j = 0; j < rowNode.childNodes.length; j++)
        {
            var colNode = rowNode.childNodes[j];
            if (colNode.tagName != "TD")
                continue;
                
            if (countThisRow)
                ++ncols;
                
            if (colNode.className == "estimated_time")
            {
                showSummary = true;
                var isOpen = (rowNode.className.indexOf("closed") == -1);
                var minutes = parseInt(colNode.innerHTML);
                if (isNaN(minutes))
                {
                    isOpen ? open.unknown++ : closed.unknown++;
                    colNode.innerHTML = "?";
                }
                else
                {
                    var estimate = new TimeEstimate(0, 0, minutes);
                    isOpen ? open.add(estimate) : closed.add(estimate);
                    colNode.innerHTML = estimate.format();
                }
            }
        }
    }

    // Append summary row.
    if (showSummary)
    {
        var summary = "";
        if (!closed.zero())
            summary += closed.format() + "Completed &nbsp;&nbsp;&nbsp;&nbsp;";
        if (!open.zero())
            summary += open.format() + "Open";

        var summaryRowNode = document.createElement("tr");

        var summaryColNode1 = document.createElement("td");
        summaryColNode1.innerHTML = "<b>Est. time:</b>";
        summaryColNode1.setAttribute("bgcolor", "lightyellow");
        summaryColNode1.className == "estimated_time";

        var summaryColNode2 = document.createElement("td");
        summaryColNode2.innerHTML = summary;
        summaryColNode2.setAttribute("colspan", ncols - 1);
        summaryColNode2.setAttribute("bgcolor", "lightyellow");
        summaryColNode2.className == "estimated_time";

        summaryRowNode.appendChild(summaryColNode1);
        summaryRowNode.appendChild(summaryColNode2);
        tableBodyNode.appendChild(summaryRowNode);

        // Accumulate milestone totals, but only for the tables on the overview tab,
        // otherwise we end up counting things twice, because of the Open Tickets and
        // Closed Tickets tabs.
        if (gCurrentTab == "tab overview")
        {
            gTotalOpen.add(open);
            gTotalClosed.add(closed);
        }
    }
}

function formatTimeEstimateInput(node)
{
    // Node is:
    //   <dd class='estimated_time'>
    //   <input id="tickets_update_updates_estimated_time_string" name="tickets_update[updates][estimated_time_string]" type="text" value="1740" />
    //   minutes (or hh:mm)
    //   </dd>
    node.innerHTML = node.innerHTML.replace("or hh:mm", "or hh:mm or d m h");
    for (var i = 0; i < node.childNodes.length; i++)
    {
        var inputNode = node.childNodes[i];
        if (inputNode.tagName == "INPUT")
        {
            var minutes = parseInt(inputNode.getAttribute("value"));
            var estimate = new TimeEstimate(0, 0, minutes);
            inputNode.setAttribute("value", estimate.format());
        }
    }
}

function updateMilestoneTimes()
{
    if (gMilestoneTimeDLNode != null)
    {
        var newNodes = [];
        
        // Looking for ...
        // <dt>Estimated Time</dt>
        // <dd class='time'>7 days, 11 hours</dd>
        for (var i = 0; i < gMilestoneTimeDLNode.childNodes.length; i++)
        {
            var node = gMilestoneTimeDLNode.childNodes[i];
            if ((node.tagName == "DD") && (node.className == "time"))
            {
                // Put summary of completed tickets in the existing node.
                node.innerHTML = gTotalClosed.format() + "Completed";

                // Add new node(s) for summary of open tickets.
                //
                // dt node is redundant, so don't bother
                // var openTimeDTNode = document.createElement("dt");
                // openTimeDTNode.innerHTML = "";
                // newNodes.push(openTimeDTNode);

                var openTimeDDNode = document.createElement("dd");
                openTimeDDNode.className = "time";
                openTimeDDNode.innerHTML = gTotalOpen.format() + "Open";
                newNodes.push(openTimeDDNode);
            }
        }

        for (var i = 0; i < newNodes.length; i++)
            gMilestoneTimeDLNode.appendChild(newNodes[i]);
    }
}


// 
// Kick off the process on the document being loaded.
//
formatTimes(document.body);
updateMilestoneTimes();
